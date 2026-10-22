import { describe, expect, it } from 'vitest';
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
});
