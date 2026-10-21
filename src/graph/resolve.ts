import * as path from 'node:path';
import {
  edgeId,
  emptyGraph,
  fileNodeId,
  type Confidence,
  type EdgeKind,
  type FileFacts,
  type Graph,
  type GraphNode,
  type ImportFact,
  type NodeKind,
} from './types';

const JS_EXT = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.mts', '.cts'];
const NAMED_KINDS = new Set(['function', 'method', 'class', 'component', 'hook']);
/** Plain name refs (no targetKinds) only match code symbols, never framework nodes like hooks. */
const CODE_KINDS: NodeKind[] = ['function', 'method', 'class', 'component'];

const dir = (f: string) => path.posix.dirname(f);
const norm = (p: string) => {
  const n = path.posix.normalize(p);
  return n.startsWith('./') ? n.slice(2) : n;
};

/** Workspace file an import points to, or undefined (external package, unresolvable). */
export function resolveImport(from: string, imp: ImportFact, files: ReadonlySet<string>): string[] {
  const first = (cands: string[]) => {
    const hit = cands.find((c) => files.has(c));
    return hit ? [hit] : [];
  };
  if (imp.kind === 'js') {
    let base: string[];
    if (imp.spec.startsWith('.')) base = [norm(path.posix.join(dir(from), imp.spec))];
    else if (/^[@~]\//.test(imp.spec))
      base = [imp.spec.slice(2), `src/${imp.spec.slice(2)}`]; // common tsconfig alias
    else if (imp.spec.startsWith('/')) base = [imp.spec.slice(1)];
    else return []; // bare package
    const cands: string[] = [];
    for (const b of base) {
      cands.push(b, ...JS_EXT.map((e) => b + e), ...JS_EXT.map((e) => `${b}/index${e}`));
      // TS ESM style: import './a.js' that is really a.ts
      const m = /\.(m|c)?js$/.exec(b);
      if (m) cands.push(...['.ts', '.tsx', '.mts', '.cts'].map((e) => b.slice(0, -m[0].length) + e));
    }
    return first(cands);
  }
  if (imp.kind === 'php-include') {
    const spec = imp.spec.replace(/^\/+/, '');
    return first([norm(path.posix.join(dir(from), spec)), norm(spec)]);
  }
  if (imp.kind === 'py') {
    const dots = /^\.*/.exec(imp.spec)![0].length;
    const mod = imp.spec.slice(dots).replace(/\./g, '/');
    const roots: string[] = [];
    if (dots > 0) {
      let d = dir(from);
      for (let i = 1; i < dots; i++) d = dir(d);
      roots.push(d === '.' ? '' : d);
    } else {
      // Absolute import: workspace root, the importing file's folder and its ancestors (src layouts).
      for (let d = dir(from); ; d = dir(d)) {
        roots.push(d === '.' ? '' : d);
        if (d === '.' || d === '/' || d === '') break;
      }
      roots.push('');
    }
    const out = new Set<string>();
    for (const r of roots) {
      const b = [r, mod].filter(Boolean).join('/');
      const hit = [`${b}.py`, `${b}/__init__.py`].find((c) => files.has(c));
      if (hit) {
        out.add(hit);
        // `from pkg import sub`: sub may be a module
        for (const n of imp.names ?? []) {
          const sub = [`${b}/${n}.py`, `${b}/${n}/__init__.py`].find((c) => files.has(c));
          if (sub) out.add(sub);
        }
        break;
      }
      if (!mod) {
        for (const n of imp.names ?? []) {
          const sub = [`${b ? b + '/' : ''}${n}.py`, `${b ? b + '/' : ''}${n}/__init__.py`].find((c) =>
            files.has(c),
          );
          if (sub) out.add(sub);
        }
        if (out.size) break;
      }
    }
    return [...out];
  }
  return []; // php-use: resolved by class name in resolve()
}

/** Workspace graph from per-file facts. Cheap enough to run in full after every change. */
export function resolve(all: ReadonlyMap<string, FileFacts>): Graph {
  const g = emptyGraph();
  const files = new Set(all.keys());
  const byName = new Map<string, GraphNode[]>();
  const addEdge = (from: string, to: string, kind: EdgeKind, confidence: Confidence) => {
    if (from === to || !g.nodes.has(from) || !g.nodes.has(to)) return;
    const id = edgeId(from, to, kind);
    const prev = g.edges.get(id);
    if (!prev || rank[confidence] > rank[prev.confidence])
      g.edges.set(id, { id, from, to, kind, confidence });
  };

  for (const f of all.values())
    for (const n of f.nodes) {
      if (g.nodes.has(n.id)) continue; // first wins (shared framework nodes like wp hooks)
      g.nodes.set(n.id, n);
      if (NAMED_KINDS.has(n.kind)) {
        const name = String(n.meta?.name ?? n.label);
        let list = byName.get(name);
        if (!list) byName.set(name, (list = []));
        list.push(n);
      }
    }

  const imported = new Map<string, Set<string>>();
  for (const f of all.values()) {
    const out = new Set<string>();
    for (const imp of f.imports) {
      let targets = resolveImport(f.file, imp, files);
      let conf: Confidence = 'high';
      if (imp.kind === 'php-use') {
        targets = (byName.get(imp.spec) ?? []).filter((n) => n.kind === 'class').map((n) => n.file);
        conf = targets.length === 1 ? 'medium' : 'low';
      }
      for (const t of targets) {
        out.add(t);
        addEdge(fileNodeId(f.file), fileNodeId(t), 'imports', conf);
      }
    }
    imported.set(f.file, out);
  }

  for (const f of all.values()) {
    for (const e of f.edges) addEdge(e.from, e.to, e.kind, e.confidence);
    const near = imported.get(f.file)!;
    for (const r of f.refs) {
      let cands = byName.get(r.name) ?? [];
      const kinds = r.targetKinds ?? CODE_KINDS;
      cands = cands.filter((n) => kinds.includes(n.kind));
      if (r.receiver) {
        const m = cands.filter((n) => n.kind === 'method');
        if (m.length) cands = m;
      }
      if (!cands.length) continue;
      const fromNode = g.nodes.get(r.from);
      const sameClass = r.receiver === 'self' && fromNode?.meta?.class;
      const pick = (sel: GraphNode[], c: Confidence) =>
        sel.length ? (sel.forEach((n) => addEdge(r.from, n.id, r.kind, c)), true) : false;
      if (
        sameClass &&
        pick(
          cands.filter((n) => n.file === f.file && n.meta?.class === sameClass),
          'high',
        )
      )
        continue;
      if (
        pick(
          cands.filter((n) => n.file === f.file),
          'high',
        )
      )
        continue;
      if (
        pick(
          cands.filter((n) => near.has(n.file)),
          'high',
        )
      )
        continue;
      if (cands.length === 1) pick(cands, r.receiver === 'other' ? 'low' : 'medium');
      else if (cands.length <= 3) pick(cands, 'low');
      // ponytail: >3 same-name candidates across unrelated files are dropped as noise; type-aware resolution would fix it
    }
  }
  return g;
}

const rank: Record<Confidence, number> = { low: 0, medium: 1, high: 2 };
