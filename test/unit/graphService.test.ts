import { describe, expect, it } from 'vitest';
import { extractors } from '../../src/graph/extractors';
import { GraphBuilder } from '../../src/graph/GraphBuilder';
import { GraphService } from '../../src/graph/GraphService';
import { getParser } from './helpers';

const service = async (limit = 50) => {
  const g = new GraphService(new GraphBuilder(await getParser(), extractors), limit);
  g.builder.setFile('x.ts', 'export function x1() {}\n');
  g.builder.setFile('y.ts', 'export function y1() {}\n');
  g.rebuildNow('Initial index');
  return g;
};
const names = (ids: string[]) => ids.map((id) => id.split('::').pop()).sort();

describe('GraphService', () => {
  it('a pending preview stays correct when another file changes meanwhile', async () => {
    const g = await service();
    g.setPending(
      { editId: 'e1', file: 'x.ts', uncertain: false },
      'export function x1() {}\nexport function x2() {}\n',
    );
    g.setFile('y.ts', 'export function y1() {}\nexport function yNew() {}\n', 'e2');
    g.flush();
    const v = g.view();
    expect(names(v.diff.addedNodes)).toEqual(['x2']);
    expect(v.diff.removedNodes).toEqual([]); // yNew must not look reverted
    g.dispose();
  });

  it('a scrubbed step stays put when old snapshots are evicted', async () => {
    const g = await service(3);
    for (let i = 2; i <= 3; i++) {
      g.setFile('x.ts', `export function x${i}() {}\n`, `e${i}`);
      g.flush();
    }
    g.select(1);
    const shown = g.view().step!.id;
    g.setFile('x.ts', 'export function x9() {}\n', 'e9');
    g.flush();
    expect(g.view().step!.id).toBe(shown);
    g.dispose();
  });

  it('the oldest kept step still shows its diff after eviction', async () => {
    const g = await service(2);
    for (let i = 2; i <= 4; i++) {
      g.setFile('x.ts', `export function x${i}() {}\n`, `e${i}`);
      g.flush();
    }
    g.select(0);
    const v = g.view();
    expect(names(v.diff.addedNodes)).toEqual(['x3']);
    expect(names(v.diff.removedNodes)).toEqual(['x2']);
    g.dispose();
  });

  it('setting identical text again is not a change', async () => {
    const g = await service();
    const before = g.snapshots.list.length;
    g.setFile('x.ts', 'export function x1() {}\n', 'e1');
    g.flush();
    expect(g.snapshots.list.length).toBe(before);
    g.dispose();
  });
});
