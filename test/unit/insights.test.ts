import { describe, expect, it } from 'vitest';
import { extractors } from '../../src/graph/extractors';
import { GraphBuilder } from '../../src/graph/GraphBuilder';
import { GraphService } from '../../src/graph/GraphService';
import { sccs } from '../../src/graph/insights';
import { builderFor, fixture, getParser } from './helpers';

const service = async (files: Record<string, string>) => {
  const svc = new GraphService(new GraphBuilder(await getParser(), extractors));
  for (const [f, t] of Object.entries(files)) svc.builder.setFile(f, t);
  svc.rebuildNow('Initial index');
  return svc;
};

describe('insights', () => {
  it('Tarjan finds multi-node SCCs only', async () => {
    const g = (await builderFor(fixture('js-app'))).build();
    // util -> helper and (nothing back): no cycle in the fixture
    expect(sccs(g, new Set(['imports']))).toEqual([]);
  });

  it('flags a seeded circular import introduced by an edit, not pre-existing ones', async () => {
    const svc = await service({
      'a.ts': "import { b } from './b';\nexport const a = () => b();\n",
      'b.ts': 'export const b = () => 1;\n',
    });
    svc.setFile('b.ts', "import { a } from './a';\nexport const b = () => a();\n", 'e1');
    svc.flush();
    const msgs = svc.view().insights.map((i) => i.message);
    expect(msgs).toContain('New circular import: a.ts → b.ts → a.ts');
    expect(msgs).toContain('New call cycle: a → b → a');
    // Next unrelated edit: the cycle is no longer "new".
    svc.setFile('c.ts', 'export const c = 1;\n', 'e2');
    svc.flush();
    expect(svc.view().insights).toEqual([]);
    svc.dispose();
  });

  it('flags newly orphaned functions and calls to removed functions', async () => {
    const svc = await service({
      'a.py': 'from b import helper\n\ndef main():\n    helper()\n    other()\n\n\ndef other():\n    pass\n',
      'b.py': 'def helper():\n    pass\n',
    });
    svc.setFile(
      'a.py',
      'from b import helper\n\ndef main():\n    helper()\n\n\ndef other():\n    pass\n',
      'e1',
    );
    svc.setFile('b.py', '\n', 'e2');
    svc.flush();
    const msgs = svc.view().insights.map((i) => i.message);
    expect(msgs).toContain('other no longer has any callers');
    expect(msgs).toContain('helper was removed but is still called from main');
    svc.dispose();
  });

  it('scrubbing reproduces past graphs', async () => {
    const svc = await service({ 'a.ts': 'export function a() {}\n' });
    svc.setFile('a.ts', 'export function a() {}\nexport function b() {}\n', 'e1');
    svc.flush();
    svc.setFile('a.ts', 'export function b() {}\n', 'e2');
    svc.flush();
    const [s0, s1, s2] = svc.snapshots.list;
    svc.select(1);
    expect(svc.view().after).toBe(s1!.graph);
    expect(svc.view().base).toBe(s0!.graph);
    expect(svc.view().diff.addedNodes).toEqual(['a.ts::function::b']);
    svc.select(null);
    expect(svc.view().after).toBe(s2!.graph);
    expect(svc.view().diff.removedNodes).toEqual(['a.ts::function::a']);
    svc.dispose();
  });
});
