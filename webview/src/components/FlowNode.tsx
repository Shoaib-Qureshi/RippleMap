import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import type { GraphNode } from '../../../src/shared/messages';

export type FlowNodeData = { node: GraphNode; vertical: boolean };

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
  const { node, vertical } = data;
  // Files: show the folder (disambiguates index.ts); symbols: show the file.
  const sub = node.kind === 'file' ? node.file.slice(0, Math.max(0, node.file.lastIndexOf('/'))) : node.file;
  return (
    <div
      className={`fl-node kind-${node.kind}${selected ? ' selected' : ''}`}
      title={`${node.kind} · ${node.file}`}
    >
      <Handle type="target" position={vertical ? Position.Top : Position.Left} />
      <span className="fl-kind" aria-hidden>
        {KIND_ICON[node.kind]}
      </span>
      <span className="fl-label">
        {node.label}
        {sub && <small>{sub}</small>}
      </span>
      <Handle type="source" position={vertical ? Position.Bottom : Position.Right} />
    </div>
  );
}

export type ClusterData = { label: string };

export function ClusterNode({ data }: NodeProps<Node<ClusterData>>) {
  return <div className="fl-cluster-label">{data.label}</div>;
}
