import type { Node } from '@vscode/tree-sitter-wasm';
import { stringValue, walk, type Extractor } from './Extractor';
import { CLOSURE_TYPES, closureNode, entryNode, link } from './framework';

const VERBS = new Set(['get', 'post', 'put', 'patch', 'delete', 'all', 'options', 'head']);
const HTTP_EXPORTS = new Set(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);
/** Receivers that are HTTP clients / maps, not servers: `axios.get('/x', cfg)`, `cache.delete('/x')`. */
const CLIENTS =
  /^(axios|http|\$http|httpClient|client|fetcher|ky|got|superagent|request|cache|map|params|searchParams|headers|cookies|storage|localStorage|sessionStorage|redis)$/i;
const HANDLER_TYPES = new Set([...CLOSURE_TYPES, 'identifier', 'member_expression']);

/** Next.js app router: `app/api/items/route.ts` -> "/api/items", `app/route.ts` -> "/". */
const nextRoutePath = (file: string) => {
  const p = /(?:^|\/)app((?:\/[^/]+)*)\/route\.[cm]?[jt]sx?$/.exec(file)?.[1];
  return p === undefined ? undefined : p.replace(/\/\([^)]+\)/g, '') || '/';
};

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
      // A server route has a handler after the path; client calls (`axios.get('/api/x')`) don't.
      const receiver = f!.childForFieldName('object')?.text.split('.').pop() ?? '';
      if (
        CLIENTS.test(receiver) ||
        !HANDLER_TYPES.has(argNodes[argNodes.length - 1]!.type) ||
        argNodes.length < 2
      )
        return;
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
      if (st?.type !== 'export_statement') continue;
      const decl = st.childForFieldName('declaration');
      // [exported name, local function it refers to]
      const names: [string | undefined, string | undefined][] =
        decl?.type === 'function_declaration'
          ? [[decl.childForFieldName('name')?.text, decl.childForFieldName('name')?.text]]
          : decl?.type === 'lexical_declaration'
            ? decl.namedChildren.flatMap((d): [string | undefined, string | undefined][] => {
                const target = d?.childForFieldName('name');
                // `export const { GET, POST } = handlers` (NextAuth v5)
                if (target?.type === 'object_pattern')
                  return target.namedChildren
                    .filter((c) => c?.type === 'shorthand_property_identifier_pattern')
                    .map((c) => [c!.text, c!.text]);
                return [[target?.text, target?.text]];
              })
            : // `export { handler as GET, handler as POST }` (NextAuth style)
              (st.namedChildren.find((c) => c?.type === 'export_clause')?.namedChildren ?? []).map((sp) => [
                (sp?.childForFieldName('alias') ?? sp?.childForFieldName('name'))?.text,
                sp?.childForFieldName('name')?.text,
              ]);
      for (const [name, local] of names) {
        if (!name || !local || !HTTP_EXPORTS.has(name)) continue;
        const id = entryNode(
          facts,
          'route',
          `${file}::route::${name} ${routePath}`,
          `${name} ${routePath}`,
          st!,
          { method: name, path: routePath },
        );
        link(facts, id, { ref: { name: local, targetKinds: ['function'] } });
      }
    }
  },
};
