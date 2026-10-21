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
};
const opts: ViewOptions = {
  level: 'files',
  mode: 'after',
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
  it('caps nodes, keeping changed then most connected', () => {
    const v = visibleGraph(g, { ...opts, mode: 'diff', maxNodes: 2 });
    expect(v.nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
    expect(v.hidden).toBe(2);
  });
});
