import { Background, Controls, MarkerType, MiniMap, ReactFlow, type Edge, type Node } from '@xyflow/react';
import { useMemo, useState } from 'react';
import { useStore } from '../store';
import { layoutGraph, NODE_H, NODE_W } from '../layout';
import { activities, sharedNodes, simpleEdges, visibleGraph } from '../view';
import { vscode } from '../vscode';
import { ExportPanel } from './ExportPanel';
import { ClusterNode, FlowNode, type ClusterData, type FlowNodeData } from './FlowNode';

const nodeTypes = { flow: FlowNode, cluster: ClusterNode };

export function GraphCanvas() {
  const {
    graph,
    level,
    mode,
    focus,
    layout,
    search,
    folder,
    hiddenKinds,
    init,
    selectedId,
    flowRoot,
    flowDepth,
    notes,
    simple,
    set,
  } = useStore();
  const [hover, setHover] = useState<string | null>(null);
  // Focus fade: hover always; selection only outside flow view (there the whole flow is the focus).
  const active = hover ?? (flowRoot ? null : selectedId);
  const activity = useMemo(() => activities(graph), [graph]);
  const visible = useMemo(
    () =>
      visibleGraph(graph, {
        level,
        mode,
        focus,
        search,
        folder,
        hiddenKinds,
        maxNodes: init?.maxNodes ?? 1500,
        flowRoot,
        flowDepth,
      }),
    [graph, level, mode, focus, search, folder, hiddenKinds, init, flowRoot, flowDepth],
  );

  const shared = useMemo(() => {
    const m = simple ? sharedNodes(visible) : new Map<string, number>();
    // A changed shared node keeps its lines: who depends on it is exactly what the change affects.
    for (const n of visible.nodes) if (n.status !== 'unchanged') m.delete(n.id);
    return m;
  }, [simple, visible]);
  // What's drawn (and exported) when nothing is hovered.
  const baseEdges = useMemo(() => simpleEdges(visible.edges, shared, null), [visible, shared]);

  const positioned = useMemo(
    () => layoutGraph(visible.nodes, baseEdges, layout),
    [visible, baseEdges, layout],
  );

  const { nodes, edges } = useMemo(() => {
    const { positions, clusters } = positioned;
    const vertical = layout === 'TB';
    // Diff colors only in Diff mode; unchanged elements are dimmed when something changed.
    const colored = mode === 'diff';
    const anyChange = colored && visible.nodes.some((n) => n.status !== 'unchanged');
    const warned = new Set(graph.insights.flatMap((w) => w.nodeIds));
    const shownEdges = active ? simpleEdges(visible.edges, shared, active) : baseEdges;
    // Hover/selection focus: the active node and its direct neighbors stay bright.
    const near = new Set<string>(active ? [active] : []);
    for (const e of shownEdges) if (e.from === active || e.to === active) near.add(e.from).add(e.to);
    const cls = (status: string) =>
      colored ? `status-${status}${anyChange && status === 'unchanged' ? ' dimmed' : ''}` : '';
    const nodes: Node[] = [
      ...clusters.map((c): Node<ClusterData> => ({
        id: c.id,
        type: 'cluster',
        position: { x: c.x, y: c.y },
        data: { label: c.label },
        style: { width: c.width, height: c.height },
        width: c.width,
        height: c.height,
        className: 'fl-cluster',
        selectable: false,
        draggable: false,
        zIndex: -1,
      })),
      ...visible.nodes.map((n): Node<FlowNodeData> => ({
        id: n.id,
        type: 'flow',
        // Known sizes: controlled nodes never get measured dims written back, and the minimap needs them.
        width: NODE_W,
        height: NODE_H,
        position: positions.get(n.id)!,
        data: {
          node: n,
          vertical,
          status: colored ? n.status : 'unchanged',
          activity: activity.get(n.id),
          note: notes[n.id],
          shared: shared.get(n.id),
        },
        selected: n.id === selectedId,
        className: `${cls(n.status)}${warned.has(n.id) ? ' warn' : ''}${n.id === flowRoot ? ' flow-root' : ''}${active && !near.has(n.id) ? ' faded' : ''}`,
      })),
    ];
    const edges: Edge[] = shownEdges.map((e): Edge => ({
      id: e.id,
      source: e.from,
      target: e.to,
      className: `fl-edge kind-${e.kind} conf-${e.confidence} ${cls(e.status)}${!active ? '' : e.from === active || e.to === active ? ' hl' : ' faded'}`,
      animated: e.kind === 'registers',
      markerEnd: {
        type: MarkerType.ArrowClosed,
        width: 16,
        height: 16,
        // Explicit color for every edge: an undefined color yields an invisible marker.
        color:
          colored && e.status !== 'unchanged'
            ? `var(--fl-${e.status})`
            : 'var(--vscode-editorLineNumber-foreground, #858585)',
      },
    }));
    return { nodes, edges };
  }, [
    visible,
    positioned,
    layout,
    mode,
    selectedId,
    graph.insights,
    flowRoot,
    activity,
    notes,
    shared,
    active,
    baseEdges,
  ]);

  if (!graph.nodes.length)
    return (
      <div className="fl-empty">
        No graph yet. FlowLens indexes JS/TS, PHP and Python files in this workspace.
      </div>
    );
  if (!visible.nodes.length)
    return (
      <div className="fl-empty">
        Nothing to show at this level with the current filters
        {level === 'functions' ? ' (no functions, classes or hooks found)' : ''}.
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
        // Remount (and re-fit the viewport) when the view changes shape; live graph updates keep the viewport.
        key={`${level}|${layout}|${focus}|${mode}|${flowRoot}|${flowDepth}`}
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
        onNodeMouseEnter={(_, n) => n.type === 'flow' && setHover(n.id)}
        onNodeMouseLeave={() => setHover(null)}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={24} size={1} />
        <Controls showInteractive={false} />
        <ExportPanel
          nodes={visible.nodes}
          edges={baseEdges}
          layout={positioned}
          vertical={layout === 'TB'}
          colored={mode === 'diff'}
        />
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
