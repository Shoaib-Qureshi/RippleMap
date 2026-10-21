import { describe, expect, it } from 'vitest';
import type { PayloadEdge, PayloadNode } from '../../src/shared/messages';
import { layoutGraph } from '../../webview/src/layout';
import { toSvg } from '../../webview/src/svgExport';

const colors = {
  bg: '#000',
  fg: '#fff',
  muted: '#999',
  nodeBg: '#111',
  border: '#333',
  edge: '#888',
  added: '#0f0',
  removed: '#f00',
  modified: '#fa0',
};

describe('toSvg', () => {
  it('draws every node and edge with diff colors and escapes labels', () => {
    const nodes: PayloadNode[] = [
      { id: 'a', kind: 'file', label: 'a<b>.ts', file: 'src/a.ts', status: 'modified' },
      { id: 'b', kind: 'file', label: 'b.ts', file: 'src/b.ts', status: 'added' },
    ];
    const edges: PayloadEdge[] = [
      { id: 'e', from: 'a', to: 'b', kind: 'imports', confidence: 'high', status: 'added' },
    ];
    const { svg, width, height } = toSvg(nodes, edges, layoutGraph(nodes, edges, 'LR'), false, true, colors);
    expect(width).toBeGreaterThan(190 * 2);
    expect(height).toBeGreaterThan(40);
    expect(svg.match(/<g transform=/g)).toHaveLength(2);
    expect(svg.match(/<path [^>]*fill="none"/g)).toHaveLength(1); // edges (marker paths are filled)
    expect(svg).toContain('stroke="#0f0" stroke-width="2"'); // added edge + node
    expect(svg).toContain('stroke="#fa0"'); // modified node
    expect(svg).toContain('a&#60;b&#62;.ts');
    expect(svg).not.toContain('a<b>');
  });
});
