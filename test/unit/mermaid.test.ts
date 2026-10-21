import { describe, expect, it } from 'vitest';
import { toMermaid } from '../../webview/src/mermaid';

describe('toMermaid', () => {
  it('emits nodes, edges, diff classes and dashed removed edges', () => {
    const out = toMermaid(
      [
        { id: 'a', kind: 'file', label: 'a.ts', file: 'src/a.ts', status: 'modified' },
        { id: 'b', kind: 'function', label: 'say "hi"', file: 'src/b.ts', status: 'added' },
      ],
      [
        { id: 'e1', from: 'a', to: 'b', kind: 'calls', confidence: 'high', status: 'added' },
        { id: 'e2', from: 'b', to: 'a', kind: 'imports', confidence: 'high', status: 'removed' },
      ],
      'LR',
      true,
    );
    expect(out).toContain('flowchart LR');
    expect(out).toContain('n0["a.ts<br/><small>src/a.ts</small>"]:::modified');
    expect(out).toContain('n1["say #quot;hi#quot;<br/><small>function · src/b.ts</small>"]:::added');
    expect(out).toContain('n0 -->|calls| n1');
    expect(out).toContain('n1 -.->|imports| n0');
    expect(out).toContain('linkStyle 0 stroke:#2ea043');
  });
});
