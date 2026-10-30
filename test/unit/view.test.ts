import { describe, expect, it } from 'vitest';
import type { GraphPayload } from '../../src/shared/messages';
import {
  activities,
  describe as about,
  overview,
  reachedDuring,
  sharedNodes,
  simpleEdges,
  visibleGraph,
  type ViewOptions,
} from '../../webview/src/view';

const g: GraphPayload = {
  nodes: [
    { id: 'a', kind: 'file', label: 'a.ts', file: 'src/a.ts', status: 'modified' },
    { id: 'b', kind: 'file', label: 'b.ts', file: 'src/b.ts', status: 'unchanged' },
    { id: 'c', kind: 'file', label: 'c.ts', file: 'lib/c.ts', status: 'added' },
    { id: 'f', kind: 'function', label: 'go', file: 'src/a.ts', status: 'unchanged' },
    { id: 'r', kind: 'file', label: 'r.ts', file: 'src/r.ts', status: 'removed' },
  ],
  edges: [
    { id: 'ab', from: 'a', to: 'b', kind: 'imports', confidence: 'high', status: 'unchanged' },
    { id: 'ac', from: 'a', to: 'c', kind: 'imports', confidence: 'high', status: 'added' },
    { id: 'ar', from: 'a', to: 'r', kind: 'imports', confidence: 'high', status: 'removed' },
    { id: 'ff', from: 'f', to: 'f', kind: 'calls', confidence: 'high', status: 'unchanged' },
  ],
  summary: '',
  counts: { addedNodes: 1, removedNodes: 1, modifiedNodes: 1, addedEdges: 1, removedEdges: 1 },
  step: null,
  steps: [],
  pending: null,
  insights: [],
  agent: null,
};
const opts: ViewOptions = {
  level: 'files',
  mode: 'after',
  focus: 'all',
  search: '',
  folder: '',
  hiddenKinds: new Set(),
  maxNodes: 100,
};

describe('visibleGraph', () => {
  it('filters by level, folder and search', () => {
    expect(visibleGraph(g, opts).nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    expect(visibleGraph(g, { ...opts, folder: 'src' }).edges.map((e) => e.id)).toEqual(['ab']);
    expect(visibleGraph(g, { ...opts, search: 'C.T' }).nodes.map((n) => n.id)).toEqual(['c']);
    expect(visibleGraph(g, { ...opts, level: 'functions' }).nodes.map((n) => n.id)).toEqual(['f']);
  });
  it('Current hides added, After hides removed, Diff shows both', () => {
    const ids = (mode: ViewOptions['mode']) => visibleGraph(g, { ...opts, mode }).edges.map((e) => e.id);
    expect(ids('current')).toEqual(['ab', 'ar']);
    expect(ids('after')).toEqual(['ab', 'ac']);
    expect(ids('diff')).toEqual(['ab', 'ac', 'ar']);
  });
  it('focus=changed keeps changed nodes and their 1-hop neighbors', () => {
    const g2 = {
      ...g,
      nodes: [
        ...g.nodes,
        { id: 'z', kind: 'file' as const, label: 'z.ts', file: 'z.ts', status: 'unchanged' as const },
      ],
    };
    expect(visibleGraph(g2, { ...opts, mode: 'diff', focus: 'changed' }).nodes.map((n) => n.id)).toEqual([
      'a',
      'b',
      'c',
      'r',
    ]);
    expect(visibleGraph(g2, { ...opts, mode: 'diff', focus: 'all' }).nodes).toHaveLength(5);
  });
  it('flow view: downstream to depth + direct callers, ignoring level and filters', () => {
    const chain: GraphPayload = {
      ...g,
      nodes: ['caller', 'root', 'b', 'c', 'd', 'other'].map((id) => ({
        id,
        kind: 'function' as const,
        label: id,
        file: 'x.ts',
        status: 'unchanged' as const,
      })),
      edges: [
        ['caller', 'root'],
        ['root', 'b'],
        ['b', 'c'],
        ['c', 'd'],
        ['other', 'b'],
      ].map(([from, to]) => ({
        id: `${from}-${to}`,
        from: from!,
        to: to!,
        kind: 'calls' as const,
        confidence: 'high' as const,
        status: 'unchanged' as const,
      })),
    };
    const ids = (flowDepth: number) =>
      visibleGraph(chain, { ...opts, level: 'files', search: 'zzz', flowRoot: 'root', flowDepth }).nodes.map(
        (n) => n.id,
      );
    expect(ids(1)).toEqual(['caller', 'root', 'b']);
    expect(ids(2)).toEqual(['caller', 'root', 'b', 'c']);
    expect(ids(0)).toEqual(['caller', 'root', 'b', 'c', 'd']);
    // Unknown root falls back to the normal view.
    expect(visibleGraph(chain, { ...opts, level: 'functions', flowRoot: 'gone' }).nodes).toHaveLength(6);
  });
  it('caps nodes, keeping changed then most connected', () => {
    const v = visibleGraph(g, { ...opts, mode: 'diff', maxNodes: 2 });
    expect(v.nodes.map((n) => n.id).sort()).toEqual(['a', 'c']);
    expect(v.hidden).toBe(2);
  });
  it('activities: files list changed symbols, symbols say what happened', () => {
    const a = activities({ ...g, agent: 'Claude Code' });
    expect(a.get('a')).toBe('Claude Code: edited');
    expect(a.get('c')).toBe('Claude Code: created file');
    expect(a.get('b')).toBeUndefined();
    const g2: GraphPayload = {
      ...g,
      pending: { file: 'src/a.ts', uncertain: false },
      nodes: [...g.nodes, { id: 'h', kind: 'function', label: 'save', file: 'src/a.ts', status: 'added' }],
      agent: 'Claude Code',
    };
    expect(activities(g2).get('a')).toBe('Claude Code (proposed): added save');
    expect(activities(g2).get('h')).toBe('Claude Code (proposed): added');
  });
  it('simple mode hides unchanged lines into shared nodes unless active', () => {
    const files = ['hub', 'p1', 'p2', 'p3', 'p4', 'p5'];
    const nodes = files.map((id) => ({
      id,
      kind: 'file' as const,
      label: id,
      file: id,
      status: 'unchanged' as const,
    }));
    const edges = files.slice(1).map((from, i) => ({
      id: from,
      from,
      to: 'hub',
      kind: 'imports' as const,
      confidence: 'high' as const,
      status: i === 0 ? ('added' as const) : ('unchanged' as const),
    }));
    edges.push({ ...edges[1]!, id: 'p2-p3', to: 'p3' });
    const shared = sharedNodes({ nodes, edges, hidden: 0 });
    expect([...shared]).toEqual([['hub', 5]]);
    expect(simpleEdges(edges, shared, null).map((e) => e.id)).toEqual(['p1', 'p2-p3']); // added edge stays
    expect(simpleEdges(edges, shared, 'p4').map((e) => e.id)).toEqual(['p1', 'p4', 'p2-p3']);
    expect(simpleEdges(edges, shared, 'hub')).toHaveLength(6);
  });
  it('overview: entry points, core files (not generated), files nothing imports', () => {
    const f = (file: string, meta?: Record<string, unknown>) => ({
      id: file,
      kind: 'file' as const,
      label: file.split('/').pop()!,
      file,
      status: 'unchanged' as const,
      meta,
    });
    const imp = (from: string, to: string) => ({
      id: `${from}>${to}`,
      from,
      to,
      kind: 'imports' as const,
      confidence: 'high' as const,
      status: 'unchanged' as const,
    });
    const pages = ['app/(main)/page.tsx', 'app/admin/users/page.tsx', 'app/api/items/route.ts'];
    const graph: GraphPayload = {
      ...g,
      nodes: [
        ...pages.map((p) => f(p)),
        f('lib/db.ts'),
        f('lib/gen/client.ts', { doc: 'This is code generated by Prisma.' }),
        f('lib/old.ts'),
        f('next.config.ts'),
        { id: 'wp::hook::init', kind: 'hook', label: 'init', file: 'p.php', status: 'unchanged' },
        { id: 'p.php::function::boot', kind: 'function', label: 'boot', file: 'p.php', status: 'unchanged' },
      ],
      edges: [
        ...pages.flatMap((p) => [imp(p, 'lib/db.ts'), imp(p, 'lib/gen/client.ts')]),
        { ...imp('wp::hook::init', 'p.php::function::boot'), kind: 'registers' },
      ],
    };
    const o = overview(graph);
    expect(o.entries.map((e) => `${e.label} ${e.hint}`)).toEqual([
      '/ page',
      '/admin/users page',
      '/api/items API route',
      'init hook · 1 handler',
    ]);
    expect(o.core.map((c) => c.label)).toEqual(['db.ts']);
    expect(o.unused.map((u) => u.id)).toEqual(['lib/old.ts']);
    expect(
      about(
        graph.nodes.find((n) => n.id === 'lib/old.ts')!,
        graph,
      ).impact,
    ).toMatch(/Nothing imports/);
    expect(
      about(
        graph.nodes.find((n) => n.id === 'next.config.ts')!,
        graph,
      ).impact,
    ).toBeUndefined();
  });

  it('reachedDuring: calls between the previous snapshot and this one (latest: and since)', () => {
    const step = (index: number, ts: number) => ({ index, id: `s${index}`, ts, label: '', edits: 1 });
    const steps = [step(0, 100), step(1, 200), step(2, 300)];
    const chip = (ts: number, target: string, status: 'ok' | 'error' | 'running' = 'ok') => ({
      ts,
      kind: 'mcp' as const,
      target,
      status,
    });
    const items = [
      chip(150, 'slack'),
      chip(160, 'slack', 'error'),
      chip(250, 'github'),
      chip(350, 'db', 'running'),
    ];
    const at = (i: number) => reachedDuring(items, { ...g, steps, step: steps[i]! });
    expect(at(1)).toEqual([{ kind: 'mcp', target: 'slack', calls: 2, problems: 1, running: 0 }]);
    // latest step: its own window plus everything after it, running calls first
    expect(at(2).map((r) => r.target)).toEqual(['db', 'github']);
    expect(reachedDuring(items, { ...g, step: null })).toEqual([]);
  });
});
