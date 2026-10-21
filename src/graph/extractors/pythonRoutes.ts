import type { Node } from '@vscode/tree-sitter-wasm';
import { stringValue, walk, type Extractor } from './Extractor';
import { entryNode, link } from './framework';

const VERBS = new Set(['route', 'get', 'post', 'put', 'patch', 'delete', 'api_route', 'websocket']);

function kwarg(argList: Node | null, key: string): Node | undefined {
  for (const a of argList?.namedChildren ?? [])
    if (a?.type === 'keyword_argument' && a.childForFieldName('name')?.text === key)
      return a.childForFieldName('value') ?? undefined;
}

/** Flask / FastAPI routes: `@app.route('/x')`, `@router.get('/x')`, `app.add_url_rule('/x', view_func=f)`. */
export const pythonRoutesExtractor: Extractor = {
  id: 'pythonRoutes',
  languages: ['python'],
  extract({ file, root, facts }) {
    const route = (verb: string, args: Node | null, at: Node, handler: string | undefined) => {
      const path = stringValue(args?.namedChildren[0]);
      if (!path?.startsWith('/') || !handler) return;
      let method = verb === 'route' || verb === 'api_route' ? 'GET' : verb.toUpperCase();
      const methods = kwarg(args, 'methods');
      const first = stringValue(methods?.namedChildren[0]);
      if (first) method = first.toUpperCase();
      const id = entryNode(facts, 'route', `${file}::route::${method} ${path}`, `${method} ${path}`, at, {
        method,
        path,
      });
      link(facts, id, { ref: { name: handler, targetKinds: ['function', 'method'] } });
    };
    walk(root, (n) => {
      if (n.type === 'decorated_definition') {
        const def = n.childForFieldName('definition');
        const name = def?.type === 'function_definition' ? def.childForFieldName('name')?.text : undefined;
        for (const d of n.namedChildren) {
          const call = d?.type === 'decorator' ? d.namedChildren[0] : null;
          const f = call?.type === 'call' ? call.childForFieldName('function') : null;
          const verb = f?.type === 'attribute' ? f.childForFieldName('attribute')?.text : undefined;
          if (verb && VERBS.has(verb)) route(verb, call!.childForFieldName('arguments'), n, name);
        }
      } else if (n.type === 'call') {
        const f = n.childForFieldName('function');
        if (f?.type === 'attribute' && f.childForFieldName('attribute')?.text === 'add_url_rule') {
          const args = n.childForFieldName('arguments');
          const view = kwarg(args, 'view_func');
          route('route', args, n, view?.type === 'identifier' ? view.text : undefined);
        }
      }
    });
  },
};
