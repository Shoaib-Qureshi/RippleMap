import { Graph, layout } from '@dagrejs/dagre';
import type { GraphEdge, GraphNode } from '../../src/shared/messages';
import { folderOf } from './view';

export type LayoutMode = 'TB' | 'LR' | 'cluster';

export const NODE_W = 230;
export const NODE_H = 54;

export interface Positioned {
  positions: Map<string, { x: number; y: number }>;
  /** Folder boxes (cluster mode only), top-left coordinates. */
  clusters: { id: string; label: string; x: number; y: number; width: number; height: number }[];
}

const GAP = 48;

/**
 * dagre layout. Cluster mode groups nodes by folder using a compound graph. Otherwise each connected group
 * is laid out on its own and the groups are packed in rows, biggest first, with edgeless nodes in a grid
 * at the end (one dagre run would stack every small group into a single tall, unreadable column).
 */
export function layoutGraph(all: GraphNode[], edges: GraphEdge[], mode: LayoutMode): Positioned {
  if (mode === 'cluster') return dagreLayout(all, edges, mode);
  const groups = connectedGroups(all, edges);
  const singles = groups.filter((g) => g.length === 1).map((g) => g[0]!);
  const blocks: { w: number; h: number; place: (x: number, y: number) => void }[] = [];
  const positions = new Map<string, { x: number; y: number }>();
  for (const group of groups.filter((g) => g.length > 1)) {
    const ids = new Set(group.map((n) => n.id));
    const sub = dagreLayout(
      group,
      edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
      mode,
    );
    blocks.push({
      w: sub.width,
      h: sub.height,
      place: (x, y) => sub.positions.forEach((p, id) => positions.set(id, { x: p.x + x, y: p.y + y })),
    });
  }
  const cell = { w: NODE_W + 24, h: NODE_H + 24 };
  const area = blocks.reduce((a, b) => a + b.w * b.h, 0) + singles.length * cell.w * cell.h;
  const rowWidth = Math.max(...blocks.map((b) => b.w), Math.sqrt(area) * 1.4, cell.w * 4);
  if (singles.length) {
    const cols = Math.max(1, Math.floor(rowWidth / cell.w));
    const sorted = [...singles].sort((a, b) => a.file.localeCompare(b.file));
    blocks.push({
      w: Math.min(cols, sorted.length) * cell.w,
      h: Math.ceil(sorted.length / cols) * cell.h,
      place: (x, y) =>
        sorted.forEach((n, i) =>
          positions.set(n.id, { x: x + 20 + (i % cols) * cell.w, y: y + 20 + Math.floor(i / cols) * cell.h }),
        ),
    });
  }
  // Shelf packing: left to right, wrap when the row is full.
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const b of blocks) {
    if (x > 0 && x + b.w > rowWidth) {
      x = 0;
      y += rowH + GAP;
      rowH = 0;
    }
    b.place(x, y);
    x += b.w + GAP;
    rowH = Math.max(rowH, b.h);
  }
  return { positions, clusters: [] };
}

/** Undirected connected groups, biggest first. */
function connectedGroups(nodes: GraphNode[], edges: GraphEdge[]): GraphNode[][] {
  const parent = new Map(nodes.map((n) => [n.id, n.id]));
  const find = (id: string): string => {
    let r = id;
    while (parent.get(r) !== r) r = parent.get(r)!;
    parent.set(id, r); // shortcut for the next lookup
    return r;
  };
  for (const e of edges) if (parent.has(e.from) && parent.has(e.to)) parent.set(find(e.from), find(e.to));
  const groups = new Map<string, GraphNode[]>();
  for (const n of nodes) {
    const r = find(n.id);
    groups.set(r, [...(groups.get(r) ?? []), n]);
  }
  return [...groups.values()].sort((a, b) => b.length - a.length);
}

function dagreLayout(
  nodes: GraphNode[],
  edges: GraphEdge[],
  mode: LayoutMode,
): Positioned & { width: number; height: number } {
  const g = new Graph({ compound: mode === 'cluster', multigraph: false });
  g.setGraph({ rankdir: mode === 'TB' ? 'TB' : 'LR', nodesep: 24, ranksep: 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  const folders = new Set<string>();
  for (const n of nodes) {
    g.setNode(n.id, { width: NODE_W, height: NODE_H });
    if (mode === 'cluster') {
      const f = `cluster:${folderOf(n.file)}`;
      if (!folders.has(f)) {
        folders.add(f);
        g.setNode(f, { label: folderOf(n.file), paddingTop: 28 } as never);
      }
      g.setParent(n.id, f);
    }
  }
  for (const e of edges) g.setEdge(e.from, e.to);
  layout(g);

  const positions = new Map<string, { x: number; y: number }>();
  for (const n of nodes) {
    const p = g.node(n.id);
    positions.set(n.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  }
  const clusters = [...folders].map((id) => {
    const p = g.node(id);
    return {
      id,
      label: id.slice('cluster:'.length),
      x: p.x - p.width / 2,
      y: p.y - p.height / 2 - 14,
      width: p.width,
      height: p.height + 14,
    };
  });
  return { positions, clusters, width: g.graph().width ?? 0, height: g.graph().height ?? 0 };
}
