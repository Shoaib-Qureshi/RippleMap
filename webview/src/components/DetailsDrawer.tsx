import { useEffect, useMemo, useState } from 'react';
import { MAX_NOTE, type GraphNode } from '../../../src/shared/messages';
import { useStore } from '../store';
import { activities } from '../view';
import { vscode } from '../vscode';

export function DetailsDrawer() {
  const { graph, selectedId, flowRoot, notes, set, showFlow } = useStore();
  const activity = useMemo(() => activities(graph), [graph]);
  const node = graph.nodes.find((n) => n.id === selectedId);
  if (!node) return null;
  const doing = activity.get(node.id);
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
      {doing && <p className="fl-activity">{doing}</p>}
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
      <NoteEditor key={node.id} node={node} saved={notes[node.id] ?? ''} />
      {list(node.kind === 'file' ? 'Imported by' : 'Callers / incoming', incoming, 'from')}
      {list(node.kind === 'file' ? 'Imports' : 'Callees / outgoing', outgoing, 'to')}
    </aside>
  );
}

/** The user's instruction for the AI agent, handed to Claude Code whenever it edits this node's file. */
function NoteEditor({ node, saved }: { node: GraphNode; saved: string }) {
  const [draft, setDraft] = useState(saved);
  useEffect(() => setDraft(saved), [saved]);
  const save = (text: string) => vscode.postMessage({ type: 'note:set', nodeId: node.id, text });
  return (
    <section className="fl-note">
      <h3>📝 Instructions for the AI</h3>
      <textarea
        aria-label="Instructions for the AI agent"
        maxLength={MAX_NOTE}
        placeholder={`e.g. "If you change this, also update the cache in save(). Don't add new dependencies."`}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
      />
      <div className="fl-actions">
        <button disabled={draft.trim() === saved} onClick={() => save(draft)}>
          Save
        </button>
        {saved && <button onClick={() => save('')}>Remove</button>}
      </div>
      <p className="fl-muted">
        Claude Code gets this whenever it edits {node.file} (needs the FlowLens hooks).
      </p>
    </section>
  );
}
