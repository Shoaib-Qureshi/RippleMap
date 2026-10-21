import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { useMemo } from 'react';
import { useStore } from '../store';
import { layoutGraph } from '../layout';
import { visibleGraph } from '../view';
import { vscode } from '../vscode';
import { ClusterNode, FlowNode, type ClusterData, type FlowNodeData } from './FlowNode';

const nodeTypes = { flow: FlowNode, cluster: ClusterNode };

export function GraphCanvas() {
  const { graph, level, layout, search, folder, hiddenKinds, init, selectedId, set } = useStore();
  const visible = useMemo(
    () => visibleGraph(graph, { level, search, folder, hiddenKinds, maxNodes: init?.maxNodes ?? 1500 }),
    [graph, level, search, folder, hiddenKinds, init],
  );

  const { nodes, edges } = useMemo(() => {
    const { positions, clusters } = layoutGraph(visible.nodes, visible.edges, layout);
    const vertical = layout === 'TB';
    const nodes: Node[] = [
      ...clusters.map((c): Node<ClusterData> => ({
        id: c.id,
        type: 'cluster',
        position: { x: c.x, y: c.y },
        data: { label: c.label },
        style: { width: c.width, height: c.height },
        className: 'fl-cluster',
        selectable: false,
        draggable: false,
        zIndex: -1,
      })),
      ...visible.nodes.map((n): Node<FlowNodeData> => ({
        id: n.id,
        type: 'flow',
        position: positions.get(n.id)!,
        data: { node: n, vertical },
        selected: n.id === selectedId,
      })),
    ];
    const edges: Edge[] = visible.edges.map((e) => ({
      id: e.id,
      source: e.from,
      target: e.to,
      className: `fl-edge kind-${e.kind} conf-${e.confidence}`,
      animated: e.kind === 'registers',
      markerEnd: { type: MarkerType.ArrowClosed, width: 16, height: 16 },
    }));
    return { nodes, edges };
  }, [visible, layout, level, selectedId]);

  if (!graph.nodes.length)
    return (
      <div className="fl-empty">
        No graph yet. FlowLens indexes JS/TS, PHP and Python files in this workspace.
      </div>
    );

  return (
    <div className="fl-canvas">
      {visible.hidden > 0 && (
        <div className="fl-banner">
          Showing the {visible.nodes.length} most connected nodes ({visible.hidden} hidden). Narrow with
          search or a folder filter.
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        fitView
        fitViewOptions={{ maxZoom: 1 }}
        minZoom={0.05}
        nodesConnectable={false}
        onlyRenderVisibleElements
        onNodeClick={(_, n) => {
          if (n.type !== 'flow') return;
          const gn = (n.data as FlowNodeData).node;
          set({ selectedId: gn.id });
          vscode.postMessage({ type: 'openFile', file: gn.file, line: gn.range?.startLine });
        }}
        onPaneClick={() => set({ selectedId: null })}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        <MiniMap
          pannable
          zoomable
          className="fl-minimap"
          nodeClassName={(n) => (n.type === 'cluster' ? 'mm-cluster' : 'mm-node')}
        />
      </ReactFlow>
    </div>
  );
}
