import type { EdgeKind, Graph, GraphNode, NodeKind } from './types';

export interface GraphDiff {
  addedNodes: string[];
  removedNodes: string[];
  modifiedNodes: string[];
  addedEdges: string[];
  removedEdges: string[];
  summary: string;
}

const changed = (a: GraphNode, b: GraphNode) => a.hash !== b.hash || a.label !== b.label || a.kind !== b.kind;

/** Set difference on stable ids; "modified" = same id, different content hash. */
export function diffGraphs(before: Graph, after: Graph): GraphDiff {
  const d: GraphDiff = {
    addedNodes: [],
    removedNodes: [],
    modifiedNodes: [],
    addedEdges: [],
    removedEdges: [],
    summary: '',
  };
  for (const [id, n] of after.nodes) {
    const prev = before.nodes.get(id);
    if (!prev) d.addedNodes.push(id);
    else if (changed(prev, n)) d.modifiedNodes.push(id);
  }
  for (const id of before.nodes.keys()) if (!after.nodes.has(id)) d.removedNodes.push(id);
  for (const id of after.edges.keys()) if (!before.edges.has(id)) d.addedEdges.push(id);
  for (const id of before.edges.keys()) if (!after.edges.has(id)) d.removedEdges.push(id);
  d.summary = summarize(d, before, after);
  return d;
}

const NODE_WORD: Record<NodeKind, [string, string]> = {
  file: ['file', 'files'],
  function: ['function', 'functions'],
  method: ['method', 'methods'],
  class: ['class', 'classes'],
  hook: ['hook', 'hooks'],
  route: ['route', 'routes'],
  shortcode: ['shortcode', 'shortcodes'],
  component: ['component', 'components'],
};
const EDGE_WORD: Record<EdgeKind, [string, string]> = {
  imports: ['import', 'imports'],
  calls: ['call', 'calls'],
  registers: ['hook registration', 'hook registrations'],
  renders: ['render', 'renders'],
  extends: ['inheritance link', 'inheritance links'],
};

function phrase<K extends string>(
  ids: string[],
  kindOf: (id: string) => K | undefined,
  words: Record<K, [string, string]>,
): string[] {
  const counts = new Map<K, number>();
  for (const id of ids) {
    const k = kindOf(id);
    if (k) counts.set(k, (counts.get(k) ?? 0) + 1);
  }
  return [...counts].map(([k, n]) => `${n} ${words[k][n === 1 ? 0 : 1]}`);
}

/** Plain-language impact, e.g. "Adds 2 functions, 1 call; removes 1 import; changes 1 function; affects 3 callers." */
export function summarize(d: GraphDiff, before: Graph, after: Graph): string {
  const nodeKind = (id: string) => (after.nodes.get(id) ?? before.nodes.get(id))?.kind;
  const edgeKind = (id: string) => (after.edges.get(id) ?? before.edges.get(id))?.kind;
  // Files are "modified" on any edit; only mention them when nothing finer-grained changed.
  const symbolMods = d.modifiedNodes.filter((id) => nodeKind(id) !== 'file');
  const mods = symbolMods.length ? symbolMods : d.modifiedNodes;

  const parts: string[] = [];
  const add = [...phrase(d.addedNodes, nodeKind, NODE_WORD), ...phrase(d.addedEdges, edgeKind, EDGE_WORD)];
  const rem = [
    ...phrase(d.removedNodes, nodeKind, NODE_WORD),
    ...phrase(d.removedEdges, edgeKind, EDGE_WORD),
  ];
  const chg = phrase(mods, nodeKind, NODE_WORD);
  if (add.length) parts.push(`adds ${add.join(', ')}`);
  if (rem.length) parts.push(`removes ${rem.join(', ')}`);
  if (chg.length) parts.push(`changes ${chg.join(', ')}`);

  // Callers of changed/removed symbols that did not change themselves.
  const touched = new Set([...symbolMods, ...d.removedNodes]);
  const unchangedNow = (id: string) => !touched.has(id) && !d.addedNodes.includes(id);
  const callers = new Set<string>();
  for (const g of [before, after])
    for (const e of g.edges.values())
      if (e.kind !== 'imports' && touched.has(e.to) && unchangedNow(e.from)) callers.add(e.from);
  if (callers.size) parts.push(`affects ${callers.size} caller${callers.size === 1 ? '' : 's'}`);

  if (!parts.length) return 'No change to the graph.';
  const s = parts.join('; ');
  return `${s[0]!.toUpperCase()}${s.slice(1)}.`;
}

/** Short status-bar text, e.g. "+2 nodes · −1 edge". */
export function shortStats(d: GraphDiff): string {
  const n = (count: number, word: string, sign: string) =>
    count ? `${sign}${count} ${word}${count === 1 ? '' : 's'}` : '';
  return [
    n(d.addedNodes.length, 'node', '+'),
    n(d.removedNodes.length, 'node', '−'),
    n(d.addedEdges.length, 'edge', '+'),
    n(d.removedEdges.length, 'edge', '−'),
  ]
    .filter(Boolean)
    .join(' · ');
}
