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

type Point = { x: number; y: number };
/** A rectangle of laid-out nodes that `pack` can place anywhere. */
type Block = { w: number; h: number; place: (x: number, y: number) => void };

const GAP = 48;
const CELL = { w: NODE_W + 24, h: NODE_H + 24 };
/** Folder box padding: sides/bottom, and room for the label on top. */
const PAD = 12;
const LABEL = 28;

/**
 * Each connected group is laid out on its own with dagre and the groups are packed in rows, biggest first,
 * with edgeless nodes in a grid at the end (one dagre run stacks every small group into a single tall,
 * unreadable column). Cluster mode does the same inside each folder and packs one box per folder; no dagre
 * compound graphs (they stack folders into one column too, and throw on some inputs).
 */
export function layoutGraph(all: GraphNode[], edges: GraphEdge[], mode: LayoutMode): Positioned {
  return mode === 'cluster' ? clustered(all, edges) : packedGroups(all, edges, mode);
}

function packedGroups(all: GraphNode[], edges: GraphEdge[], rankdir: 'LR' | 'TB'): Positioned {
  const groups = connectedGroups(all, edges);
  const singles = groups.filter((g) => g.length === 1).map((g) => g[0]!);
  const positions = new Map<string, Point>();
  const blocks: Block[] = groups
    .filter((g) => g.length > 1)
    .map((group) => {
      const ids = new Set(group.map((n) => n.id));
      const sub = dagreLayout(
        group,
        edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
        rankdir,
      );
      return {
        w: sub.width,
        h: sub.height,
        place: (x, y) => sub.positions.forEach((p, id) => positions.set(id, { x: p.x + x, y: p.y + y })),
      };
    });
  const width = rowWidth(blocks, singles.length);
  if (singles.length) {
    const cols = Math.max(1, Math.floor(width / CELL.w));
    const sorted = [...singles].sort((a, b) => a.file.localeCompare(b.file));
    blocks.push({
      w: Math.min(cols, sorted.length) * CELL.w,
      h: Math.ceil(sorted.length / cols) * CELL.h,
      place: (x, y) =>
        sorted.forEach((n, i) =>
          positions.set(n.id, { x: x + 20 + (i % cols) * CELL.w, y: y + 20 + Math.floor(i / cols) * CELL.h }),
        ),
    });
  }
  pack(blocks, width);
  return { positions, clusters: [] };
}

/** One box per folder (folders in name order); inside each, the packed layout of its own nodes. */
function clustered(all: GraphNode[], edges: GraphEdge[]): Positioned {
  const byFolder = new Map<string, GraphNode[]>();
  for (const n of all) byFolder.set(folderOf(n.file), [...(byFolder.get(folderOf(n.file)) ?? []), n]);
  const positions = new Map<string, Point>();
  const clusters: Positioned['clusters'] = [];
  const blocks: Block[] = [...byFolder]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([folder, nodes]) => {
      const ids = new Set(nodes.map((n) => n.id));
      const inner = packedGroups(
        nodes,
        edges.filter((e) => ids.has(e.from) && ids.has(e.to)),
        'LR',
      ).positions;
      const ps = [...inner.values()];
      const minX = Math.min(...ps.map((p) => p.x));
      const minY = Math.min(...ps.map((p) => p.y));
      const w = Math.max(...ps.map((p) => p.x)) + NODE_W - minX + 2 * PAD;
      const h = Math.max(...ps.map((p) => p.y)) + NODE_H - minY + PAD + LABEL;
      return {
        w,
        h,
        place: (x, y) => {
          inner.forEach((p, id) => positions.set(id, { x: x + PAD + p.x - minX, y: y + LABEL + p.y - minY }));
          clusters.push({ id: `cluster:${folder}`, label: folder, x, y, width: w, height: h });
        },
      };
    });
  pack(blocks, rowWidth(blocks, 0));
  return { positions, clusters };
}

/** Roughly square overall, never narrower than the widest block. */
function rowWidth(blocks: Block[], cells: number): number {
  const area = blocks.reduce((a, b) => a + b.w * b.h, 0) + cells * CELL.w * CELL.h;
  return Math.max(...blocks.map((b) => b.w), Math.sqrt(area) * 1.4, CELL.w * 4);
}

/** Shelf packing: left to right, wrap when the row is full. */
function pack(blocks: Block[], width: number): void {
  let x = 0;
  let y = 0;
  let rowH = 0;
  for (const b of blocks) {
    if (x > 0 && x + b.w > width) {
      x = 0;
      y += rowH + GAP;
      rowH = 0;
    }
    b.place(x, y);
    x += b.w + GAP;
    rowH = Math.max(rowH, b.h);
  }
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
  rankdir: 'LR' | 'TB',
): { positions: Map<string, Point>; width: number; height: number } {
  const g = new Graph({ multigraph: false });
  g.setGraph({ rankdir, nodesep: 24, ranksep: 60, marginx: 20, marginy: 20 });
  g.setDefaultEdgeLabel(() => ({}));
  for (const n of nodes) g.setNode(n.id, { width: NODE_W, height: NODE_H });
  for (const e of edges) g.setEdge(e.from, e.to);
  layout(g);
  const positions = new Map<string, Point>();
  for (const n of nodes) {
    const p = g.node(n.id);
    positions.set(n.id, { x: p.x - NODE_W / 2, y: p.y - NODE_H / 2 });
  }
  return { positions, width: g.graph().width ?? 0, height: g.graph().height ?? 0 };
}
