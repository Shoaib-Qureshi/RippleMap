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

/**
 * dagre layout. Cluster mode groups nodes by folder using a compound graph. Otherwise nodes without edges
 * go in a grid under the graph (dagre would stack them in one tall column).
 */
export function layoutGraph(all: GraphNode[], edges: GraphEdge[], mode: LayoutMode): Positioned {
  const linked = new Set(edges.flatMap((e) => [e.from, e.to]));
  const grid = mode === 'cluster' ? [] : all.filter((n) => !linked.has(n.id));
  const nodes = grid.length ? all.filter((n) => linked.has(n.id)) : all;
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
  if (grid.length) {
    const gw = nodes.length ? (g.graph().width ?? 0) : 0;
    const gh = nodes.length ? (g.graph().height ?? 0) : 0;
    const cols = Math.max(4, Math.ceil(Math.sqrt(grid.length)), Math.floor(gw / (NODE_W + 24)));
    [...grid]
      .sort((a, b) => a.file.localeCompare(b.file))
      .forEach((n, i) =>
        positions.set(n.id, {
          x: 20 + (i % cols) * (NODE_W + 24),
          y: gh + 20 + Math.floor(i / cols) * (NODE_H + 24),
        }),
      );
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
  return { positions, clusters };
}
