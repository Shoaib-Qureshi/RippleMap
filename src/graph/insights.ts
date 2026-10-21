import type { GraphDiff } from './GraphDiffer';
import type { EdgeKind, FileFacts, Graph } from './types';

export interface Insight {
  kind: 'cycle' | 'orphan' | 'dangling';
  message: string;
  nodeIds: string[];
}

/** Strongly connected components (Tarjan, iterative) over edges of the given kinds. Only SCCs of size > 1. */
export function sccs(g: Graph, kinds: ReadonlySet<EdgeKind>): string[][] {
  const adj = new Map<string, string[]>();
  for (const e of g.edges.values()) {
    if (!kinds.has(e.kind) || e.from === e.to) continue;
    let l = adj.get(e.from);
    if (!l) adj.set(e.from, (l = []));
    l.push(e.to);
  }
  let index = 0;
  const idx = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const out: string[][] = [];
  for (const start of adj.keys()) {
    if (idx.has(start)) continue;
    const work: [string, number][] = [[start, 0]];
    while (work.length) {
      const top = work[work.length - 1]!;
      const [v, i] = top;
      if (i === 0) {
        idx.set(v, index);
        low.set(v, index++);
        stack.push(v);
        onStack.add(v);
      }
      const next = adj.get(v) ?? [];
      if (i < next.length) {
        top[1]++;
        const w = next[i]!;
        if (!idx.has(w)) work.push([w, 0]);
        else if (onStack.has(w)) low.set(v, Math.min(low.get(v)!, idx.get(w)!));
        continue;
      }
      work.pop();
      const parent = work[work.length - 1];
      if (parent) low.set(parent[0], Math.min(low.get(parent[0])!, low.get(v)!));
      if (low.get(v) === idx.get(v)) {
        const comp: string[] = [];
        let w: string;
        do {
          w = stack.pop()!;
          onStack.delete(w);
          comp.push(w);
        } while (w !== v);
        if (comp.length > 1) out.push(comp.reverse());
      }
    }
  }
  return out;
}

const ENTRY_KINDS = new Set(['hook', 'route', 'shortcode']);

/** Risk warnings for a change (base -> after). `afterFacts` lets us find calls to symbols that no longer exist. */
export function insights(
  base: Graph,
  after: Graph,
  diff: GraphDiff,
  afterFacts?: ReadonlyMap<string, FileFacts>,
): Insight[] {
  const out: Insight[] = [];
  const label = (id: string) => (after.nodes.get(id) ?? base.nodes.get(id))?.label ?? id;
  const added = new Set(diff.addedEdges);

  // 1. New cycles: an SCC that contains at least one edge added by this change.
  for (const [kinds, what] of [
    [new Set<EdgeKind>(['imports']), 'circular import'],
    [new Set<EdgeKind>(['calls']), 'call cycle'],
  ] as const) {
    for (const comp of sccs(after, kinds)) {
      const inComp = new Set(comp);
      const isNew = [...after.edges.values()].some(
        (e) => added.has(e.id) && kinds.has(e.kind) && inComp.has(e.from) && inComp.has(e.to),
      );
      if (isNew)
        out.push({
          kind: 'cycle',
          message: `New ${what}: ${[...comp, comp[0]!].map(label).join(' → ')}`,
          nodeIds: comp,
        });
    }
  }

  // 2. Newly orphaned: had incoming calls/registrations before, none now.
  const incoming = (g: Graph) => {
    const m = new Map<string, number>();
    for (const e of g.edges.values())
      if (e.kind !== 'imports' && e.kind !== 'extends') m.set(e.to, (m.get(e.to) ?? 0) + 1);
    return m;
  };
  const inBefore = incoming(base);
  const inAfter = incoming(after);
  for (const n of after.nodes.values()) {
    if (n.kind === 'file' || ENTRY_KINDS.has(n.kind) || n.meta?.anonymous) continue;
    if ((inBefore.get(n.id) ?? 0) > 0 && !inAfter.get(n.id))
      out.push({ kind: 'orphan', message: `${n.label} no longer has any callers`, nodeIds: [n.id] });
  }

  // 3. Removed symbols that are still referenced by name somewhere.
  if (afterFacts) {
    const removed = new Map<string, string>();
    for (const id of diff.removedNodes) {
      const n = base.nodes.get(id);
      if (n && ['function', 'method', 'class', 'component'].includes(n.kind))
        removed.set(String(n.meta?.name ?? n.label), id);
    }
    const stillDefined = new Set<string>();
    for (const n of after.nodes.values()) stillDefined.add(String(n.meta?.name ?? n.label));
    for (const [name, id] of removed) {
      if (stillDefined.has(name)) continue;
      const callers = new Set<string>();
      for (const f of afterFacts.values())
        for (const r of f.refs) if (r.name === name && r.kind !== 'extends') callers.add(r.from);
      if (callers.size)
        out.push({
          kind: 'dangling',
          message: `${label(id)} was removed but is still called from ${[...callers].map(label).slice(0, 3).join(', ')}${callers.size > 3 ? '…' : ''}`,
          nodeIds: [id, ...callers],
        });
    }
  }
  return out;
}
