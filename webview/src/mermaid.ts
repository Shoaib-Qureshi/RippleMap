// Pure: visible graph -> Mermaid flowchart (status kept as classes, removed edges dashed).
import type { PayloadEdge, PayloadNode } from '../../src/shared/messages';

const esc = (s: string) => s.replace(/"/g, '#quot;').replace(/[<>]/g, (c) => (c === '<' ? '#lt;' : '#gt;'));

export function toMermaid(
  nodes: PayloadNode[],
  edges: PayloadEdge[],
  direction: 'LR' | 'TB',
  colored: boolean,
): string {
  const ids = new Map(nodes.map((n, i) => [n.id, `n${i}`]));
  const lines = [`flowchart ${direction}`];
  for (const n of nodes) {
    const cls = colored && n.status !== 'unchanged' ? `:::${n.status}` : '';
    lines.push(
      `  ${ids.get(n.id)}["${esc(n.label)}<br/><small>${esc(n.kind === 'file' ? n.file : `${n.kind} · ${n.file}`)}</small>"]${cls}`,
    );
  }
  edges.forEach((e, i) => {
    const a = ids.get(e.from);
    const b = ids.get(e.to);
    if (!a || !b) return;
    const arrow = colored && e.status === 'removed' ? '-.->' : '-->';
    lines.push(`  ${a} ${arrow}|${e.kind}| ${b}`);
    if (colored && e.status !== 'unchanged')
      lines.push(`  linkStyle ${i} stroke:${e.status === 'added' ? '#2ea043' : '#f85149'},stroke-width:2px`);
  });
  if (colored)
    lines.push(
      '  classDef added stroke:#2ea043,stroke-width:2px',
      '  classDef removed stroke:#f85149,stroke-width:2px,stroke-dasharray:4 3',
      '  classDef modified stroke:#d29922,stroke-width:2px',
    );
  return lines.join('\n') + '\n';
}
