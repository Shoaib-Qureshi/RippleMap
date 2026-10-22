import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { GraphNode, Status } from '../../../src/shared/messages';

export type FlowNodeData = {
  node: GraphNode;
  vertical: boolean;
  status: Status;
  /** What the agent did to this node (changed nodes only). */
  activity?: string;
  /** User's instruction for the agent. */
  note?: string;
  /** Simple mode: incoming lines hidden because many nodes use this one. */
  shared?: number;
};

export const STATUS_ICON: Record<Status, string> = { added: '+', removed: '−', modified: '~', unchanged: '' };

export const KIND_ICON: Record<GraphNode['kind'], string> = {
  file: '▤',
  function: 'ƒ',
  method: 'm',
  class: 'C',
  hook: '⚓',
  route: '⇄',
  shortcode: '[ ]',
  component: '◇',
};

export function FlowNode({ data, selected }: NodeProps<Node<FlowNodeData>>) {
  const { node, vertical, status, activity, note, shared } = data;
  // Files: show the folder (disambiguates index.ts); symbols: show the file.
  const sub = node.kind === 'file' ? node.file.slice(0, Math.max(0, node.file.lastIndexOf('/'))) : node.file;
  return (
    <div
      className={`fl-node kind-${node.kind}${selected ? ' selected' : ''}`}
      title={[
        `${node.kind} · ${node.file}${status !== 'unchanged' ? ` · ${status}` : ''}`,
        activity,
        note && `📝 For the AI: ${note}`,
        'Click for details · double-click to open the code',
      ]
        .filter(Boolean)
        .join('\n')}
    >
      <Handle type="target" position={vertical ? Position.Top : Position.Left} />
      <span className="fl-kind" aria-hidden>
        {KIND_ICON[node.kind]}
      </span>
      <span className="fl-label">
        {node.label}
        {sub && <small>{sub}</small>}
        {activity && <small className="fl-activity">{activity}</small>}
      </span>
      {note && (
        <span className="fl-note-mark" aria-label="Has instructions for the AI">
          📝
        </span>
      )}
      {shared && (
        <span
          className="fl-shared"
          title={`Used by ${shared}. Lines hidden to keep the graph simple; hover to show.`}
        >
          ⇠{shared}
        </span>
      )}
      {status !== 'unchanged' && (
        <span className="fl-status" aria-label={status}>
          {STATUS_ICON[status]}
        </span>
      )}
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} />
    </div>
  );
}

export type ClusterData = { label: string };

export function ClusterNode({ data }: NodeProps<Node<ClusterData>>) {
  return <div className="fl-cluster-label">{data.label}</div>;
}
