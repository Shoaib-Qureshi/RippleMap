// Pure view-model logic: which nodes/edges are visible. No React; unit-tested from test/unit.
import type { EdgeKind, GraphPayload, NodeKind, PayloadEdge, PayloadNode } from '../../src/shared/messages';

export type Level = 'files' | 'functions';
export type Mode = 'current' | 'after' | 'diff';

export interface ViewOptions {
  level: Level;
  mode: Mode;
  search: string;
  folder: string;
  hiddenKinds: ReadonlySet<NodeKind>;
  maxNodes: number;
}

export interface VisibleGraph {
  nodes: PayloadNode[];
  edges: PayloadEdge[];
  /** Nodes matching the filters but cut by maxNodes. */
  hidden: number;
}

const LEVEL_EDGES: Record<Level, ReadonlySet<EdgeKind>> = {
  files: new Set(['imports']),
  functions: new Set(['calls', 'registers', 'renders', 'extends']),
};

const inMode = (mode: Mode, status: PayloadNode['status']) =>
  mode === 'diff' || (mode === 'current' ? status !== 'added' : status !== 'removed');

export function visibleGraph(g: GraphPayload, o: ViewOptions): VisibleGraph {
  const q = o.search.trim().toLowerCase();
  const folder = o.folder.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  let nodes = g.nodes.filter(
    (n) =>
      inMode(o.mode, n.status) &&
      (o.level === 'files' ? n.kind === 'file' : n.kind !== 'file') &&
      !o.hiddenKinds.has(n.kind) &&
      (!folder || n.file.startsWith(folder)) &&
      (!q || n.label.toLowerCase().includes(q) || n.file.toLowerCase().includes(q)),
  );
  const kinds = LEVEL_EDGES[o.level];
  const candidateEdges = g.edges.filter((e) => kinds.has(e.kind) && inMode(o.mode, e.status));

  let hidden = 0;
  if (nodes.length > o.maxNodes) {
    // Keep changed nodes first, then the most connected.
    const degree = new Map<string, number>();
    for (const e of candidateEdges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    const score = (n: PayloadNode) => (n.status !== 'unchanged' ? 1e9 : 0) + (degree.get(n.id) ?? 0);
    hidden = nodes.length - o.maxNodes;
    nodes = [...nodes].sort((a, b) => score(b) - score(a)).slice(0, o.maxNodes);
  }
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: candidateEdges.filter((e) => ids.has(e.from) && ids.has(e.to)), hidden };
}

export const folderOf = (file: string) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.');
