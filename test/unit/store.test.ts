import { describe, expect, it } from 'vitest';
import type { GraphPayload } from '../../src/shared/messages';
import { useStore } from '../../webview/src/store';

const payload = (ids: string[]): GraphPayload => ({
  nodes: ids.map((id) => ({ id, kind: 'function', label: id, file: 'a.ts', status: 'unchanged' })),
  edges: [],
  summary: '',
  counts: { addedNodes: 0, removedNodes: 0, modifiedNodes: 0, addedEdges: 0, removedEdges: 0 },
  step: null,
  steps: [],
  pending: null,
  insights: [],
  agent: null,
});

describe('webview store', () => {
  it('drops a selection / flow root whose node disappeared, keeps ones that still exist', () => {
    const s = useStore.getState();
    s.receive({ type: 'graph:update', graph: payload(['a', 'b']) });
    s.set({ selectedId: 'a', flowRoot: 'b' });
    s.receive({ type: 'graph:update', graph: payload(['a']) });
    expect(useStore.getState()).toMatchObject({ selectedId: 'a', flowRoot: null });
    s.receive({ type: 'graph:update', graph: payload([]) });
    expect(useStore.getState().selectedId).toBeNull();
  });
});
