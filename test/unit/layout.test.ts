import { describe, expect, it } from 'vitest';
import crash from '../fixtures/cluster-crash.json';
import type { GraphEdge, GraphNode } from '../../src/shared/messages';
import { layoutGraph, NODE_H, NODE_W } from '../../webview/src/layout';

const node = (id: string): GraphNode => ({ id, kind: 'function', label: id, file: `${id}.ts` });
const edge = (from: string, to: string): GraphEdge => ({
  id: `${from}-${to}`,
  from,
  to,
  kind: 'calls',
  confidence: 'high',
});

describe('layoutGraph', () => {
  it('packs many small groups into rows without overlaps (no tall single column)', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let i = 0; i < 40; i++) {
      nodes.push(node(`hook${i}`), node(`fn${i}`));
      edges.push(edge(`hook${i}`, `fn${i}`));
    }
    for (let i = 0; i < 10; i++) nodes.push(node(`lone${i}`));
    nodes.push(node('a'), node('b'), node('c'));
    edges.push(edge('a', 'b'), edge('b', 'c'));

    for (const mode of ['LR', 'TB'] as const) {
      const { positions } = layoutGraph(nodes, edges, mode);
      expect(positions.size).toBe(nodes.length);
      const ps = [...positions.values()];
      for (let i = 0; i < ps.length; i++)
        for (let j = i + 1; j < ps.length; j++) {
          const overlap = Math.abs(ps[i]!.x - ps[j]!.x) < NODE_W && Math.abs(ps[i]!.y - ps[j]!.y) < NODE_H;
          expect(overlap).toBe(false);
        }
      const w = Math.max(...ps.map((p) => p.x)) + NODE_W;
      const h = Math.max(...ps.map((p) => p.y)) + NODE_H;
      expect(h / w).toBeLessThan(2);
    }
  });

  it('cluster mode still returns folder boxes', () => {
    const { clusters } = layoutGraph([node('a'), node('b')], [edge('a', 'b')], 'cluster');
    expect(clusters.length).toBeGreaterThan(0);
  });

  it("cluster mode survives a graph that makes dagre's compound layout throw", () => {
    // Anonymised from a real project: dagre throws "Not possible to find intersection inside of the rectangle".
    const nodes = crash.nodes as GraphNode[];
    const { positions, clusters } = layoutGraph(nodes, crash.edges as GraphEdge[], 'cluster');
    expect(positions.size).toBe(nodes.length);
    expect([...positions.values()].every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))).toBe(true);
    expect(clusters.length).toBeGreaterThan(0); // folder boxes kept (same-folder-edges retry)
  });

  it('cluster mode: each node inside its folder box, boxes never overlap, packed in rows', () => {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    for (let f = 0; f < 12; f++)
      for (let i = 0; i < 4; i++) {
        nodes.push({ id: `d${f}/n${i}`, kind: 'function', label: `n${i}`, file: `d${f}/n${i}.ts` });
        if (i) edges.push(edge(`d${f}/n${i - 1}`, `d${f}/n${i}`));
      }
    edges.push(edge('d0/n0', 'd5/n2')); // cross-folder edge
    const { positions, clusters } = layoutGraph(nodes, edges, 'cluster');
    expect(clusters).toHaveLength(12);
    for (const n of nodes) {
      const p = positions.get(n.id)!;
      const box = clusters.find((c) => c.label === n.file.split('/')[0])!;
      expect(
        p.x >= box.x &&
          p.y >= box.y &&
          p.x + NODE_W <= box.x + box.width &&
          p.y + NODE_H <= box.y + box.height,
      ).toBe(true);
    }
    for (let i = 0; i < clusters.length; i++)
      for (let j = i + 1; j < clusters.length; j++) {
        const [a, b] = [clusters[i]!, clusters[j]!];
        const overlap =
          a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }
    const w = Math.max(...clusters.map((c) => c.x + c.width));
    const h = Math.max(...clusters.map((c) => c.y + c.height));
    expect(h / w).toBeLessThan(2);
  });
});
