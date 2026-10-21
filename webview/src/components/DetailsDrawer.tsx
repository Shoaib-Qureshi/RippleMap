import type { GraphNode } from '../../../src/shared/messages';
import { useStore } from '../store';
import { vscode } from '../vscode';

export function DetailsDrawer() {
  const { graph, selectedId, flowRoot, set, showFlow } = useStore();
  const node = graph.nodes.find((n) => n.id === selectedId);
  if (!node) return null;
  const byId = new Map(graph.nodes.map((n) => [n.id, n]));
  const incoming = graph.edges.filter((e) => e.to === node.id);
  const outgoing = graph.edges.filter((e) => e.from === node.id);
  const open = (n: GraphNode) =>
    vscode.postMessage({ type: 'openFile', file: n.file, line: n.range?.startLine });
  const list = (title: string, edges: typeof incoming, end: 'from' | 'to') => (
    <section>
      <h3>
        {title} ({edges.length})
      </h3>
      <ul>
        {edges.map((e) => {
          const other = byId.get(e[end]);
          return other ? (
            <li key={e.id}>
              <button
                className="fl-link"
                onClick={() => set({ selectedId: other.id })}
                onDoubleClick={() => open(other)}
              >
                {other.label}
              </button>{' '}
              <span className="fl-muted">
                {e.kind}
                {e.confidence !== 'high' ? ` · ${e.confidence} confidence` : ''}
              </span>
            </li>
          ) : null;
        })}
      </ul>
    </section>
  );
  return (
    <aside className="fl-drawer" aria-label="Node details">
      <button className="fl-close" aria-label="Close details" onClick={() => set({ selectedId: null })}>
        ×
      </button>
      <h2>{node.label}</h2>
      <p className="fl-muted">
        {node.kind} · {node.file}
        {node.range ? `:${node.range.startLine}` : ''}
      </p>
      <div className="fl-actions">
        <button onClick={() => open(node)}>Open in editor</button>
        {flowRoot !== node.id && (
          <button
            onClick={() => showFlow(node.id)}
            title="Show only what this calls (and its direct callers)"
          >
            Show flow
          </button>
        )}
      </div>
      {list(node.kind === 'file' ? 'Imported by' : 'Callers / incoming', incoming, 'from')}
      {list(node.kind === 'file' ? 'Imports' : 'Callees / outgoing', outgoing, 'to')}
    </aside>
  );
}
