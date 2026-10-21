// Pure: laid-out visible graph -> standalone SVG (used for SVG export and rasterized for PNG).
// Drawn from our own layout instead of screenshotting the DOM: deterministic, small, CSP-safe.
import type { PayloadEdge, PayloadNode, Status } from '../../src/shared/messages';
import { NODE_H, NODE_W, type Positioned } from './layout';

export interface SvgColors {
  bg: string;
  fg: string;
  muted: string;
  nodeBg: string;
  border: string;
  edge: string;
  added: string;
  removed: string;
  modified: string;
}

const PAD = 20;
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const ICON: Record<Status, string> = { added: '+', removed: '−', modified: '~', unchanged: '' };

export function toSvg(
  nodes: PayloadNode[],
  edges: PayloadEdge[],
  layout: Positioned,
  vertical: boolean,
  colored: boolean,
  c: SvgColors,
): { svg: string; width: number; height: number } {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const p of layout.positions.values()) {
    xs.push(p.x, p.x + NODE_W);
    ys.push(p.y, p.y + NODE_H);
  }
  for (const k of layout.clusters) {
    xs.push(k.x, k.x + k.width);
    ys.push(k.y, k.y + k.height);
  }
  if (!xs.length) {
    xs.push(0);
    ys.push(0);
  }
  const minX = Math.min(...xs) - PAD;
  const minY = Math.min(...ys) - PAD;
  const width = Math.ceil(Math.max(...xs) + PAD - minX);
  const height = Math.ceil(Math.max(...ys) + PAD - minY);
  const statusColor = (s: Status) => (colored && s !== 'unchanged' ? c[s] : undefined);

  const out: string[] = [];
  const markers = new Set<string>();
  for (const k of layout.clusters)
    out.push(
      `<rect x="${k.x}" y="${k.y}" width="${k.width}" height="${k.height}" rx="6" fill="none" stroke="${c.border}" stroke-dasharray="5 4"/>`,
      `<text x="${k.x + 8}" y="${k.y + 16}" font-size="11" fill="${c.muted}">${esc(k.label)}</text>`,
    );
  for (const e of edges) {
    const a = layout.positions.get(e.from);
    const b = layout.positions.get(e.to);
    if (!a || !b) continue;
    const color = statusColor(e.status) ?? c.edge;
    markers.add(color);
    const [sx, sy, tx, ty] = vertical
      ? [a.x + NODE_W / 2, a.y + NODE_H, b.x + NODE_W / 2, b.y]
      : [a.x + NODE_W, a.y + NODE_H / 2, b.x, b.y + NODE_H / 2];
    const d = Math.max(30, Math.abs(vertical ? ty - sy : tx - sx) / 2);
    const path = vertical
      ? `M${sx},${sy} C${sx},${sy + d} ${tx},${ty - d} ${tx},${ty}`
      : `M${sx},${sy} C${sx + d},${sy} ${tx - d},${ty} ${tx},${ty}`;
    const dash =
      e.status === 'removed' && colored
        ? ' stroke-dasharray="6 4"'
        : e.confidence !== 'high'
          ? ' stroke-dasharray="4 3"'
          : '';
    out.push(
      `<path d="${path}" fill="none" stroke="${color}" stroke-width="${statusColor(e.status) ? 2 : 1}"${dash} marker-end="url(#m${[...markers].indexOf(color)})"/>`,
    );
  }
  for (const n of nodes) {
    const p = layout.positions.get(n.id);
    if (!p) continue;
    const sc = statusColor(n.status);
    const sub = n.kind === 'file' ? n.file.slice(0, Math.max(0, n.file.lastIndexOf('/'))) : n.file;
    out.push(
      `<g transform="translate(${p.x},${p.y})">`,
      `<rect width="${NODE_W}" height="${NODE_H}" rx="4" fill="${c.nodeBg}" stroke="${sc ?? c.border}" stroke-width="${sc ? 2 : 1}"${n.status === 'removed' && sc ? ' stroke-dasharray="5 3"' : ''}/>`,
      `<text x="10" y="${sub ? 17 : 24}" font-size="12" fill="${c.fg}">${esc(clip(n.label, 26))}</text>`,
      sub ? `<text x="10" y="31" font-size="9.5" fill="${c.muted}">${esc(clip(sub, 34))}</text>` : '',
      sc
        ? `<text x="${NODE_W - 14}" y="25" font-size="14" font-weight="bold" fill="${sc}">${ICON[n.status]}</text>`
        : '',
      `</g>`,
    );
  }
  const defs = [...markers]
    .map(
      (m, i) =>
        `<marker id="m${i}" viewBox="0 0 10 10" refX="10" refY="5" markerUnits="userSpaceOnUse" markerWidth="10" markerHeight="10" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="${m}"/></marker>`,
    )
    .join('');
  const svg = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${width} ${height}" font-family="-apple-system, 'Segoe UI', Roboto, sans-serif">`,
    `<defs>${defs}</defs>`,
    `<rect x="${minX}" y="${minY}" width="${width}" height="${height}" fill="${c.bg}"/>`,
    ...out,
    `</svg>`,
  ].join('\n');
  return { svg, width, height };
}
