import { Panel } from '@xyflow/react';
import { useMemo } from 'react';
import { useStore } from '../store';
import { reachedDuring } from '../view';
import { vscode } from '../vscode';

const ICON = { mcp: '🔌', web: '🌐', net: '⌨' } as const;
const WHAT = { mcp: 'MCP server', web: 'website', net: 'network command' } as const;
const SHOWN = 6;

/** Blocks for what the agent reached outside the code during the step on screen; click = Agent Activity view. */
export function Reached() {
  const graph = useStore((s) => s.graph);
  const activity = useStore((s) => s.activity);
  const reached = useMemo(() => reachedDuring(activity, graph), [activity, graph]);
  if (!reached.length) return null;
  const open = () => vscode.postMessage({ type: 'showActivity' });
  return (
    <Panel position="top-left" className="fl-reached" aria-label="Reached outside the code">
      <span className="fl-muted">Reached outside the code</span>
      {reached.slice(0, SHOWN).map((r) => (
        <button
          key={`${r.kind}:${r.target}`}
          className={`fl-reach${r.running ? ' running' : ''}${r.problems ? ' problem' : ''}`}
          title={`${WHAT[r.kind]} ${r.target}: ${r.calls} call${r.calls === 1 ? '' : 's'}${r.running ? `, ${r.running} running` : ''}${r.problems ? `, ${r.problems} failed/denied/stopped` : ''}. Click for details.`}
          onClick={open}
        >
          {ICON[r.kind]} {r.target}
          {r.calls > 1 && <small> ×{r.calls}</small>}
        </button>
      ))}
      {reached.length > SHOWN && (
        <button className="fl-reach" onClick={open}>
          +{reached.length - SHOWN} more
        </button>
      )}
    </Panel>
  );
}
