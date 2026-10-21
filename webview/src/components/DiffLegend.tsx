import { useStore } from '../store';

/** Impact summary + color legend (with icons, so it does not rely on color alone). */
export function DiffLegend() {
  const { graph } = useStore();
  const { counts, step, pending, summary } = graph;
  const title = pending
    ? `Pending edit · ${pending.file}${pending.uncertain ? ' (approximate)' : ''}`
    : step
      ? step.label
      : '';
  return (
    <div className={`fl-legend${pending ? ' pending' : ''}`} role="status" aria-live="polite">
      {title && <strong>{title}</strong>}
      <span>{summary}</span>
      <span className="fl-spacer" />
      <span className="fl-chip status-added">+ {counts.addedNodes + counts.addedEdges} added</span>
      <span className="fl-chip status-removed">− {counts.removedNodes + counts.removedEdges} removed</span>
      <span className="fl-chip status-modified">~ {counts.modifiedNodes} modified</span>
    </div>
  );
}
