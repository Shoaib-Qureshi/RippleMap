import type { EditEvent } from '../capture/EditEvent';
import type { GraphView } from './GraphService';

/** Labels of symbols an edit touched: nodes in the file overlapping its changed lines, plus removed ones. */
export function touchedSymbols(e: EditEvent, v: GraphView): string[] {
  const out = new Set<string>();
  for (const n of v.after.nodes.values()) {
    if (n.file !== e.file || n.kind === 'file' || !n.range) continue;
    if (e.changedRanges.some((r) => r.startLine <= n.range!.endLine && r.endLine >= n.range!.startLine))
      out.add(n.label);
  }
  for (const id of v.diff.removedNodes) {
    const n = v.base.nodes.get(id);
    if (n && n.file === e.file && n.kind !== 'file') out.add(`${n.label} (removed)`);
  }
  return [...out];
}
