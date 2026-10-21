// Pure view-model logic: which nodes/edges are visible. No React; unit-tested from test/unit.
import type { EdgeKind, GraphEdge, GraphNode, GraphPayload, NodeKind } from '../../src/shared/messages';

export type Level = 'files' | 'functions';

export interface ViewOptions {
  level: Level;
  search: string;
  folder: string;
  hiddenKinds: ReadonlySet<NodeKind>;
  maxNodes: number;
}

export interface VisibleGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  /** Nodes matching the filters but cut by maxNodes. */
  hidden: number;
}

const LEVEL_EDGES: Record<Level, ReadonlySet<EdgeKind>> = {
  files: new Set(['imports']),
  functions: new Set(['calls', 'registers', 'renders', 'extends']),
};

export function visibleGraph(g: GraphPayload, o: ViewOptions): VisibleGraph {
  const q = o.search.trim().toLowerCase();
  const folder = o.folder.trim().replace(/\\/g, '/').replace(/^\/+/, '');
  let nodes = g.nodes.filter(
    (n) =>
      (o.level === 'files' ? n.kind === 'file' : n.kind !== 'file') &&
      !o.hiddenKinds.has(n.kind) &&
      (!folder || n.file.startsWith(folder)) &&
      (!q || n.label.toLowerCase().includes(q) || n.file.toLowerCase().includes(q)),
  );
  const kinds = LEVEL_EDGES[o.level];
  const candidateEdges = g.edges.filter((e) => kinds.has(e.kind));

  let hidden = 0;
  if (nodes.length > o.maxNodes) {
    // Keep the most connected nodes.
    const degree = new Map<string, number>();
    for (const e of candidateEdges) {
      degree.set(e.from, (degree.get(e.from) ?? 0) + 1);
      degree.set(e.to, (degree.get(e.to) ?? 0) + 1);
    }
    hidden = nodes.length - o.maxNodes;
    nodes = [...nodes].sort((a, b) => (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0)).slice(0, o.maxNodes);
  }
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: candidateEdges.filter((e) => ids.has(e.from) && ids.has(e.to)), hidden };
}

export const folderOf = (file: string) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.');
