import type { Node } from '@vscode/tree-sitter-wasm';
import { stringValue, walk, type Extractor } from './Extractor';
import { CLOSURE_TYPES, closureNode, entryNode, link } from './framework';

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);
const HTTP_EXPORTS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

/** Next.js app router: `app/api/items/route.ts` -> "/api/items". */
const nextRoutePath = (file: string) =>
  /(?:^|\/)app((?:\/[^/]+)*)\/route\.[cm]?[jt]sx?$/.exec(file)?.[1]?.replace(/\/\([^)]+\)/g, '') || undefined;

/** Express-style routes (`app.get('/x', handler)`) and Next.js app-router route handlers. */
export const jsRoutesExtractor: Extractor = {
  id: 'jsRoutes',
  languages: ['javascript', 'typescript', 'tsx'],
  extract({ file, root, facts }) {
    walk(root, (n) => {
      if (n.type !== 'call_expression') return;
      const f = n.childForFieldName('function');
      const verb = f?.type === 'member_expression' ? f.childForFieldName('property')?.text : undefined;
      if (!verb || !VERBS.has(verb)) return;
      const argNodes = (n.childForFieldName('arguments')?.namedChildren ?? []).filter((x): x is Node => !!x);
      const path = stringValue(argNodes[0]);
      if (!path?.startsWith('/')) return;
      const method = verb === 'all' ? 'ALL' : verb.toUpperCase();
      const id = entryNode(facts, 'route', `${file}::route::${method} ${path}`, `${method} ${path}`, n, {
        method,
        path,
      });
      for (const h of argNodes.slice(1)) {
        if (CLOSURE_TYPES.has(h.type))
          link(facts, id, { id: closureNode(facts, h, `${method} ${path} handler`) });
        else if (h.type === 'identifier')
          link(facts, id, { ref: { name: h.text, targetKinds: ['function'] } });
        else if (h.type === 'member_expression') {
          const p = h.childForFieldName('property')?.text;
          if (p) link(facts, id, { ref: { name: p, targetKinds: ['function', 'method'] } });
        }
      }
    });

    const routePath = nextRoutePath(file);
    if (routePath === undefined) return;
    for (const st of root.namedChildren) {
      const decl = st?.type === 'export_statement' ? st.childForFieldName('declaration') : null;
      const names =
        decl?.type === 'function_declaration'
          ? [decl.childForFieldName('name')?.text]
          : decl?.type === 'lexical_declaration'
            ? decl.namedChildren.map((d) => d?.childForFieldName('name')?.text)
            : [];
      for (const name of names) {
        if (!name || !HTTP_EXPORTS.has(name)) continue;
        const id = entryNode(
          facts,
          'route',
          `${file}::route::${name} ${routePath}`,
          `${name} ${routePath}`,
          st!,
          { method: name, path: routePath },
        );
        link(facts, id, { ref: { name, targetKinds: ['function'] } });
      }
    }
  },
};
