import type { GraphPayload, Status, StepInfo } from '../shared/messages';
import type { GraphView } from './GraphService';
import type { Snapshot } from './SnapshotStore';

export const stepInfo = (s: Snapshot, index: number): StepInfo => ({
  index,
  id: s.id,
  ts: s.ts,
  label: s.label,
  edits: s.editIds.length,
});

/** Union of base + after with a status per element, ready for the webview. Pure. */
export function toPayload(v: GraphView, steps: readonly Snapshot[]): GraphPayload {
  const { base, after, diff } = v;
  const added = new Set(diff.addedNodes);
  const modified = new Set(diff.modifiedNodes);
  const addedE = new Set(diff.addedEdges);
  const nodes: GraphPayload['nodes'] = [];
  for (const n of after.nodes.values()) {
    const status: Status = added.has(n.id) ? 'added' : modified.has(n.id) ? 'modified' : 'unchanged';
    nodes.push({ ...n, status });
  }
  for (const id of diff.removedNodes) nodes.push({ ...base.nodes.get(id)!, status: 'removed' });
  const edges: GraphPayload['edges'] = [];
  for (const e of after.edges.values())
    edges.push({ ...e, status: addedE.has(e.id) ? 'added' : 'unchanged' });
  for (const id of diff.removedEdges) edges.push({ ...base.edges.get(id)!, status: 'removed' });
  return {
    nodes,
    edges,
    summary:
      !v.pending && !v.step?.base // the very first snapshot (baseline), even after eviction shifts indexes
        ? 'No changes yet. Edits by you or your AI agent will show here: green added, red removed, amber changed.'
        : diff.summary,
    counts: {
      addedNodes: diff.addedNodes.length,
      removedNodes: diff.removedNodes.length,
      modifiedNodes: diff.modifiedNodes.length,
      addedEdges: diff.addedEdges.length,
      removedEdges: diff.removedEdges.length,
    },
    step: v.step ? stepInfo(v.step, v.stepIndex) : null,
    steps: steps.map(stepInfo),
    pending: v.pending ? { file: v.pending.file, uncertain: v.pending.uncertain } : null,
    insights: v.insights,
    agent: null,
  };
}
