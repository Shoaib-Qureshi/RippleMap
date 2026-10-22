import { describe, expect, it } from 'vitest';
import { extractors } from '../../src/graph/extractors';
import { GraphBuilder } from '../../src/graph/GraphBuilder';
import { getParser } from './helpers';

const graph = async (files: Record<string, string>) => {
  const b = new GraphBuilder(await getParser(), extractors);
  for (const [f, t] of Object.entries(files)) b.setFile(f, t);
  return b.build();
};
const labels = async (files: Record<string, string>, kind: string) =>
  [...(await graph(files)).nodes.values()]
    .filter((n) => n.kind === kind)
    .map((n) => n.label)
    .sort();

describe('route and class detection (audit regressions)', () => {
  it('HTTP-client calls are not server routes; real Express routes still are', async () => {
    const js = [
      "await axios.get('/api/items');",
      "await api.post('/login', { user });",
      "cache.delete('/tmp');",
      "this.http.get('/x', opts);",
      "app.get('/real', (req, res) => res.send('ok'));",
      "router.post('/save', save);",
    ].join('\n');
    expect(await labels({ 'a.js': js }, 'route')).toEqual(['GET /real', 'POST /save']);
  });

  it('Next.js: export { handler as GET, handler as POST } and the root app/route.ts', async () => {
    const g = await graph({
      'app/api/auth/[...nextauth]/route.ts':
        'const handler = () => 1;\nexport { handler as GET, handler as POST };\n',
      'app/route.ts': 'export function GET() {}\n',
      'app/api/v5/route.ts': "import { handlers } from '@/auth';\nexport const { GET, POST } = handlers;\n",
    });
    const routes = [...g.nodes.values()]
      .filter((n) => n.kind === 'route')
      .map((n) => n.label)
      .sort();
    expect(routes).toEqual([
      'GET /',
      'GET /api/auth/[...nextauth]',
      'GET /api/v5',
      'POST /api/auth/[...nextauth]',
      'POST /api/v5',
    ]);
    const toHandler = [...g.edges.values()].filter(
      (e) => e.kind === 'registers' && e.to.endsWith('::handler'),
    );
    expect(toHandler).toHaveLength(2);
  });

  it('Python routes keep every listed method', async () => {
    const py = "@app.route('/a', methods=['POST', 'GET'])\ndef a():\n    pass\n";
    expect(await labels({ 'app.py': py }, 'route')).toEqual(['GET /a', 'POST /a']);
  });

  it('PHP trait and enum methods are extracted', async () => {
    const php =
      '<?php\ntrait T { function foo() { bar(); } }\nenum E { case A; function label() {} }\nfunction bar() {}\n';
    expect(await labels({ 'a.php': php }, 'method')).toEqual(['E.label', 'T.foo']);
  });

  it("import from '.' at the workspace root resolves to index", async () => {
    const g = await graph({ 'index.ts': 'export const x = 1;\n', 'a.ts': "import { x } from '.';\n" });
    expect([...g.edges.values()].filter((e) => e.kind === 'imports').map((e) => `${e.from}>${e.to}`)).toEqual(
      ['a.ts::file::a.ts>index.ts::file::index.ts'],
    );
  });
});
