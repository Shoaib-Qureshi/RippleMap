import { describe, expect, it } from 'vitest';
import type { GraphPayload } from '../../src/shared/messages';
import { visibleGraph, type ViewOptions } from '../../webview/src/view';

const g: GraphPayload = {
  nodes: [
    { id: 'a', kind: 'file', label: 'a.ts', file: 'src/a.ts', status: 'modified' },
    { id: 'b', kind: 'file', label: 'b.ts', file: 'src/b.ts', status: 'unchanged' },
    { id: 'c', kind: 'file', label: 'c.ts', file: 'lib/c.ts', status: 'added' },
    { id: 'f', kind: 'function', label: 'go', file: 'src/a.ts', status: 'unchanged' },
    { id: 'r', kind: 'file', label: 'r.ts', file: 'src/r.ts', status: 'removed' },
  ],
  edges: [
    { id: 'ab', from: 'a', to: 'b', kind: 'imports', confidence: 'high', status: 'unchanged' },
    { id: 'ac', from: 'a', to: 'c', kind: 'imports', confidence: 'high', status: 'added' },
    { id: 'ar', from: 'a', to: 'r', kind: 'imports', confidence: 'high', status: 'removed' },
    { id: 'ff', from: 'f', to: 'f', kind: 'calls', confidence: 'high', status: 'unchanged' },
  ],
  summary: '',
  counts: { addedNodes: 1, removedNodes: 1, modifiedNodes: 1, addedEdges: 1, removedEdges: 1 },
  step: null,
  steps: [],
  pending: null,
  insights: [],
};
const opts: ViewOptions = {
  level: 'files',
  mode: 'after',
  focus: 'all',
  search: '',
  folder: '',
  hiddenKinds: new Set(),
  maxNodes: 100,
};

describe('visibleGraph', () => {
  it('filters by level, folder and search', () => {
    expect(visibleGraph(g, opts).nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(visibleGraph(g, { ...opts, folder: 'src' }).edges.map((e) => e.id)).toEqual(['ab']);
    expect(visibleGraph(g, { ...opts, search: 'C.T' }).nodes.map((n) => n.id)).toEqual(['c']);
    expect(visibleGraph(g, { ...opts, level: 'functions' }).nodes.map((n) => n.id)).toEqual(['f']);
  });
  it('Current hides added, After hides removed, Diff shows both', () => {
    const ids = (mode: ViewOptions['mode']) => visibleGraph(g, { ...opts, mode }).edges.map((e) => e.id);
    expect(ids('current')).toEqual(['ab', 'ar']);
    expect(ids('after')).toEqual(['ab', 'ac']);
    expect(ids('diff')).toEqual(['ab', 'ac', 'ar']);
  });
  it('focus=changed keeps changed nodes and their 1-hop neighbors', () => {
    const g2 = {
      ...g,
      nodes: [
        ...g.nodes,
        { id: 'z', kind: 'file' as const, label: 'z.ts', file: 'z.ts', status: 'unchanged' as const },
      ],
    };
    expect(visibleGraph(g2, { ...opts, mode: 'diff', focus: 'changed' }).nodes.map((n) => n.id)).toEqual([
      'a',
      'b',
      'c',
      'r',
    ]);
    expect(visibleGraph(g2, { ...opts, mode: 'diff', focus: 'all' }).nodes).toHaveLength(5);
  });
  it('flow view: downstream to depth + direct callers, ignoring level and filters', () => {
    const chain: GraphPayload = {
      ...g,
      nodes: ['caller', 'root', 'b', 'c', 'd', 'other'].map((id) => ({
        id,
        kind: 'function' as const,
        label: id,
        file: 'x.ts',
        status: 'unchanged' as const,
      })),
      edges: [
        ['caller', 'root'],
        ['root', 'b'],
        ['b', 'c'],
        ['c', 'd'],
        ['other', 'b'],
      ].map(([from, to]) => ({
        id: `${from}-${to}`,
        from: from!,
        to: to!,
        kind: 'calls' as const,
        confidence: 'high' as const,
        status: 'unchanged' as const,
      })),
    };
    const ids = (flowDepth: number) =>
      visibleGraph(chain, { ...opts, level: 'files', search: 'zzz', flowRoot: 'root', flowDepth }).nodes.map(
        (n) => n.id,
      );
    expect(ids(1)).toEqual(['caller', 'root', 'b']);
    expect(ids(2)).toEqual(['caller', 'root', 'b', 'c']);
    expect(ids(0)).toEqual(['caller', 'root', 'b', 'c', 'd']);
    // Unknown root falls back to the normal view.
    expect(visibleGraph(chain, { ...opts, level: 'functions', flowRoot: 'gone' }).nodes).toHaveLength(6);
  });
  it('caps nodes, keeping changed then most connected', () => {
    const v = visibleGraph(g, { ...opts, mode: 'diff', maxNodes: 2 });
    expect(v.nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
    expect(v.hidden).toBe(2);
  });
});
