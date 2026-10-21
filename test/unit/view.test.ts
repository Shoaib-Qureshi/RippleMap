import { describe, expect, it } from 'vitest';
import type { GraphPayload } from '../../src/shared/messages';
import { visibleGraph, type ViewOptions } from '../../webview/src/view';

const g: GraphPayload = {
  nodes: [
    { id: 'a', kind: 'file', label: 'a.ts', file: 'src/a.ts' },
    { id: 'b', kind: 'file', label: 'b.ts', file: 'src/b.ts' },
    { id: 'c', kind: 'file', label: 'c.ts', file: 'lib/c.ts' },
    { id: 'f', kind: 'function', label: 'go', file: 'src/a.ts' },
  ],
  edges: [
    { id: 'ab', from: 'a', to: 'b', kind: 'imports', confidence: 'high' },
    { id: 'ac', from: 'a', to: 'c', kind: 'imports', confidence: 'high' },
    { id: 'ff', from: 'f', to: 'f', kind: 'calls', confidence: 'high' },
  ],
};
const opts: ViewOptions = { level: 'files', search: '', folder: '', hiddenKinds: new Set(), maxNodes: 100 };

describe('visibleGraph', () => {
  it('filters by level, folder and search', () => {
    expect(visibleGraph(g, opts).nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(visibleGraph(g, { ...opts, folder: 'src' }).edges.map((e) => e.id)).toEqual(['ab']);
    expect(visibleGraph(g, { ...opts, search: 'C.T' }).nodes.map((n) => n.id)).toEqual(['c']);
    expect(visibleGraph(g, { ...opts, level: 'functions' }).nodes.map((n) => n.id)).toEqual(['f']);
  });
  it('caps nodes, keeping the most connected', () => {
    const v = visibleGraph(g, { ...opts, maxNodes: 1 });
    expect(v.nodes.map((n) => n.id)).toEqual(['a']);
    expect(v.hidden).toBe(2);
  });
});
