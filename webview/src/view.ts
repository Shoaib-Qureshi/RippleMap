// Pure view-model logic: which nodes/edges are visible. No React; unit-tested from test/unit.
import type {
  ActivityChip,
  EdgeKind,
  GraphPayload,
  NodeKind,
  PayloadEdge,
  PayloadNode,
} from '../../src/shared/messages';

export type Level = 'files' | 'functions';
export type Mode = 'current' | 'after' | 'diff';

export interface ViewOptions {
  level: Level;
  mode: Mode;
  /** 'changed': only changed nodes + 1-hop neighbors (when anything changed at this level). */
  focus: 'changed' | 'all';
  search: string;
  folder: string;
  hiddenKinds: ReadonlySet<NodeKind>;
  maxNodes: number;
  /** When set: show only this symbol's flow (overrides level, scope and filters). */
  flowRoot?: string | null;
  /** Downstream depth for the flow; 0 = unlimited. */
  flowDepth?: number;
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

export const inMode = (mode: Mode, status: PayloadNode['status']) =>
  mode === 'diff' || (mode === 'current' ? status !== 'added' : status !== 'removed');

export function visibleGraph(g: GraphPayload, o: ViewOptions): VisibleGraph {
  if (o.flowRoot) {
    const f = flowGraph(g, o.flowRoot, o.flowDepth ?? 3, o.mode);
    if (f) return f;
  }
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

  if (o.focus === 'changed') {
    const changed = new Set(nodes.filter((n) => n.status !== 'unchanged').map((n) => n.id));
    for (const e of candidateEdges) if (e.status !== 'unchanged') changed.add(e.from).add(e.to);
    if (changed.size) {
      const keep = new Set(changed);
      for (const e of candidateEdges) {
        if (changed.has(e.from)) keep.add(e.to);
        if (changed.has(e.to)) keep.add(e.from);
      }
      nodes = nodes.filter((n) => keep.has(n.id));
    }
  }

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

/**
 * A symbol's flow: everything it reaches (calls / registers / renders, or imports for a file) up to `depth`
 * hops (0 = unlimited), plus its direct callers for context. Undefined if the root is not in the graph.
 */
export function flowGraph(
  g: GraphPayload,
  rootId: string,
  depth: number,
  mode: Mode,
): VisibleGraph | undefined {
  const root = g.nodes.find((n) => n.id === rootId && inMode(mode, n.status));
  if (!root) return undefined;
  const kinds = LEVEL_EDGES[root.kind === 'file' ? 'files' : 'functions'];
  const edges = g.edges.filter((e) => kinds.has(e.kind) && inMode(mode, e.status));
  const out = new Map<string, string[]>();
  for (const e of edges) {
    let l = out.get(e.from);
    if (!l) out.set(e.from, (l = []));
    l.push(e.to);
  }
  const keep = new Set([root.id]);
  let frontier = [root.id];
  for (let d = 0; frontier.length && (depth === 0 || d < depth); d++) {
    const next: string[] = [];
    for (const id of frontier)
      for (const to of out.get(id) ?? [])
        if (!keep.has(to)) {
          keep.add(to);
          next.push(to);
        }
    frontier = next;
  }
  for (const e of edges) if (e.to === root.id) keep.add(e.from); // direct callers
  const nodes = g.nodes.filter((n) => keep.has(n.id) && inMode(mode, n.status));
  const ids = new Set(nodes.map((n) => n.id));
  return { nodes, edges: edges.filter((e) => ids.has(e.from) && ids.has(e.to)), hidden: 0 };
}

export const folderOf = (file: string) => (file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.');

const VERB = { added: 'added', removed: 'removed', modified: 'changed' } as const;

/**
 * One line per changed node saying what the agent did, e.g. "Claude Code: added save, changed load".
 * Files list their changed symbols; symbols say what happened to them.
 */
export function activities(g: GraphPayload): Map<string, string> {
  const who = `${g.agent ?? 'Edit'}${g.pending ? ' (proposed)' : ''}: `;
  const out = new Map<string, string>();
  const byFile = new Map<string, PayloadNode[]>();
  for (const n of g.nodes) {
    if (n.kind === 'file' || n.status === 'unchanged') continue;
    out.set(n.id, who + VERB[n.status]);
    byFile.set(n.file, [...(byFile.get(n.file) ?? []), n]);
  }
  for (const f of g.nodes) {
    if (f.kind !== 'file') continue;
    const changed = byFile.get(f.file) ?? [];
    if (!changed.length && f.status === 'unchanged') continue;
    const parts = changed.slice(0, 3).map((n) => `${VERB[n.status as keyof typeof VERB]} ${n.label}`);
    if (changed.length > 3) parts.push(`+${changed.length - 3} more`);
    const fallback = { added: 'created file', removed: 'deleted file', modified: 'edited', unchanged: '' };
    out.set(f.id, who + (parts.join(', ') || fallback[f.status]));
  }
  return out;
}

/**
 * "Shared" nodes that many others point at (utils, ui/button, auth): id -> incoming count.
 * ponytail: fixed threshold (used by >= 5); make it a setting if it misfires.
 */
export function sharedNodes(v: VisibleGraph): Map<string, number> {
  const indeg = new Map<string, number>();
  for (const e of v.edges) indeg.set(e.to, (indeg.get(e.to) ?? 0) + 1);
  return new Map([...indeg].filter(([, n]) => n >= 5));
}

/** Simple mode: drop unchanged edges into shared nodes, except those touching the active (hovered/selected) node. */
export function simpleEdges(
  edges: readonly PayloadEdge[],
  shared: ReadonlyMap<string, number>,
  active: string | null,
): PayloadEdge[] {
  return edges.filter(
    (e) => e.status !== 'unchanged' || !shared.has(e.to) || e.from === active || e.to === active,
  );
}

const ROLE: Record<string, string> = { page: 'Page at', layout: 'Layout for', route: 'API endpoint' };
const list = (xs: string[], max = 4) =>
  xs.slice(0, max).join(', ') + (xs.length > max ? ` +${xs.length - max} more` : '');

/**
 * Short "what is this" for the details drawer: the author's doc comment (if any) plus facts derived from
 * the graph: Next.js route/role, 'use client'/'use server', routes handled, symbols defined.
 */
export function describe(
  node: PayloadNode,
  g: GraphPayload,
): { doc?: string; facts: string; impact?: string } {
  const doc = typeof node.meta?.doc === 'string' ? node.meta.doc : undefined;
  const isFile = node.kind === 'file';
  const users = new Set(
    g.edges
      .filter(
        (e) =>
          e.to === node.id &&
          e.status !== 'removed' &&
          (isFile ? e.kind === 'imports' : e.kind !== 'imports'),
      )
      .map((e) => e.from),
  ).size;
  const impact =
    users >= 5
      ? `Used by ${users} ${isFile ? 'files' : 'callers'}. Changes here ripple widely; check them before editing.`
      : isFile &&
          !users &&
          !g.edges.some((e) => e.from === node.id && e.kind === 'imports') &&
          !CONVENTION.test(node.file)
        ? 'Nothing imports this file. It may be loaded another way (framework, script tag, cron) or be unused.'
        : undefined;
  if (!isFile) {
    const cls = node.meta?.class;
    return {
      doc,
      impact,
      facts: node.kind === 'method' && typeof cls === 'string' ? `Method of ${cls}.` : '',
    };
  }
  const facts: string[] = [];
  if (typeof node.meta?.error === 'string')
    facts.push(`FlowLens couldn't analyse this file (${node.meta.error})`);
  const next = /(?:^|\/)app\/(?:(.*)\/)?(page|layout|route)\.[jt]sx?$/.exec(node.file);
  const api = /(?:^|\/)pages\/(api\/.*?)(?:\/index)?\.[jt]s$/.exec(node.file);
  if (next)
    facts.push(`${ROLE[next[2]!]} /${(next[1] ?? '').replace(/\([^)]*\)\/?/g, '').replace(/\/$/, '')}`);
  else if (api) facts.push(`API endpoint /${api[1]}`);
  const dir = node.meta?.directive;
  if (dir === 'use server') facts.push('Server actions (run on the server)');
  else if (dir === 'use client') facts.push('Runs in the browser (client component)');
  const inFile = g.nodes.filter((n) => n.file === node.file && n.kind !== 'file' && !n.meta?.anonymous);
  const routes = inFile.filter((n) => n.kind === 'route').map((n) => n.label);
  if (routes.length) facts.push(`Handles ${list(routes, 3)}`);
  // Top-level only (nested helpers have a dotted qname); components and classes first.
  const rank = { component: 0, class: 1, function: 2 } as Record<string, number>;
  const defs = inFile
    .filter((n) => n.kind in rank && !String(n.meta?.qname ?? '').includes('.'))
    .sort((a, b) => rank[a.kind]! - rank[b.kind]!)
    .map((n) => n.label);
  if (defs.length) facts.push(`Defines ${list(defs)}`);
  return { doc, impact, facts: facts.length ? `${facts.join('. ')}.` : '' };
}

export interface OverviewItem {
  id: string;
  label: string;
  hint: string;
}
export interface Overview {
  stats: string;
  /** Where the app starts: pages, API routes, routes, framework hooks, or top-level files. */
  entries: OverviewItem[];
  /** Files many others import: changes here ripple widely. */
  core: OverviewItem[];
  /** Code files nothing imports and that aren't framework entry points. */
  unused: OverviewItem[];
}

const NEXT_ENTRY = /(?:^|\/)app\/(?:(.*)\/)?(page|route)\.[jt]sx?$/;
/** Files a framework or tool loads by convention, so "nobody imports it" is expected. */
const CONVENTION =
  /(^|\/)(page|layout|route|loading|error|not-found|global-error|template|default|middleware|proxy|instrumentation|robots|sitemap|manifest|icon|opengraph-image|functions|wp-config|index|main|app|server|setup|conftest|manage)\.[a-z]+$|\.config\.[a-z]+$|(^|\/)(tests?|__tests__|scripts?)\/|\.(test|spec)\.[a-z]+$/;
const urlOf = (dirPart: string | undefined) =>
  `/${(dirPart ?? '').replace(/\([^)]*\)\/?/g, '').replace(/\/$/, '')}`;

/** "Start here" summary of the whole project, the way a senior would walk a newcomer through it. */
export function overview(g: GraphPayload): Overview {
  const nodes = g.nodes.filter((n) => n.status !== 'removed');
  const edges = g.edges.filter((e) => e.status !== 'removed');
  const files = nodes.filter((n) => n.kind === 'file');
  const importers = new Map<string, number>();
  const linked = new Set<string>();
  const handlers = new Map<string, number>();
  for (const e of edges) {
    if (e.kind === 'imports') {
      importers.set(e.to, (importers.get(e.to) ?? 0) + 1);
      linked.add(e.from).add(e.to);
    }
    if (e.kind === 'registers') handlers.set(e.from, (handlers.get(e.from) ?? 0) + 1);
  }

  const byLabel = (a: OverviewItem, b: OverviewItem) => a.label.localeCompare(b.label);
  const entries: OverviewItem[] = [];
  const pages: OverviewItem[] = [];
  for (const f of files) {
    const m = NEXT_ENTRY.exec(f.file);
    if (m) pages.push({ id: f.id, label: urlOf(m[1]), hint: m[2] === 'page' ? 'page' : 'API route' });
  }
  entries.push(...pages.sort(byLabel));
  entries.push(
    ...nodes
      .filter((n) => n.kind === 'route')
      .map((n) => ({ id: n.id, label: n.label, hint: 'route' }))
      .sort(byLabel),
  );
  const hooks = nodes
    .filter((n) => n.kind === 'hook' && handlers.has(n.id))
    .sort((a, b) => handlers.get(b.id)! - handlers.get(a.id)!);
  for (const h of hooks)
    entries.push({
      id: h.id,
      label: h.label,
      hint: `hook · ${handlers.get(h.id)} handler${handlers.get(h.id) === 1 ? '' : 's'}`,
    });
  if (!entries.length)
    // No framework entry points: top-level files (import others, imported by none), most connected first.
    files
      .filter((f) => linked.has(f.id) && !importers.has(f.id))
      .forEach((f) => entries.push({ id: f.id, label: f.label, hint: f.file }));

  const generated = (f: PayloadNode) =>
    /(^|\/)(generated|__generated__)\//.test(f.file) || /\bgenerated\b/i.test(String(f.meta?.doc ?? ''));
  const core = files
    .filter((f) => (importers.get(f.id) ?? 0) >= 3 && !generated(f))
    .sort((a, b) => importers.get(b.id)! - importers.get(a.id)!)
    .slice(0, 6)
    .map((f) => ({ id: f.id, label: f.label, hint: `used by ${importers.get(f.id)} files · ${f.file}` }));

  const unused = files
    .filter((f) => !linked.has(f.id) && !CONVENTION.test(f.file))
    .sort((a, b) => a.file.localeCompare(b.file))
    .map((f) => ({ id: f.id, label: f.label, hint: f.file }));

  const fns = nodes.filter((n) => n.kind !== 'file' && n.kind !== 'hook' && n.kind !== 'route').length;
  return {
    stats: `${files.length} files · ${fns} functions & components${hooks.length ? ` · ${hooks.length} hooks` : ''}`,
    entries,
    core,
    unused,
  };
}

export interface Reached {
  kind: ActivityChip['kind'];
  target: string;
  calls: number;
  /** Failed, denied or stopped calls. */
  problems: number;
  running: number;
}

/**
 * What the agent reached outside the code while making the step on screen: calls between the previous
 * snapshot and this one (on the latest step, also everything since). Grouped per server / host, busiest first.
 */
export function reachedDuring(items: readonly ActivityChip[], g: GraphPayload): Reached[] {
  const step = g.step;
  if (!step) return [];
  const latest = !!g.pending || step.index === g.steps.length - 1;
  const from = g.steps[step.index - 1]?.ts ?? -Infinity;
  const to = latest ? Infinity : step.ts;
  const out = new Map<string, Reached>();
  for (const a of items) {
    if (a.ts <= from || a.ts > to) continue;
    const key = `${a.kind}:${a.target}`;
    const r = out.get(key) ?? { kind: a.kind, target: a.target, calls: 0, problems: 0, running: 0 };
    r.calls++;
    if (a.status === 'running') r.running++;
    else if (a.status !== 'ok') r.problems++;
    out.set(key, r);
  }
  return [...out.values()].sort((a, b) => b.running - a.running || b.calls - a.calls);
}
