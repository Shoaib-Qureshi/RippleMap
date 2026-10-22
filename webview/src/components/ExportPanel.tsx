import { Panel } from '@xyflow/react';
import { useState } from 'react';
import type { PayloadEdge, PayloadNode } from '../../../src/shared/messages';
import type { Positioned } from '../layout';
import { toMermaid } from '../mermaid';
import { pngScale, toSvg, type SvgColors } from '../svgExport';
import { vscode } from '../vscode';

/** Resolves theme variables now, so the exported file looks like the current VS Code theme. */
function themeColors(): SvgColors {
  const cs = getComputedStyle(document.body);
  const v = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
  return {
    bg: v('--vscode-editor-background', '#1e1e1e'),
    fg: v('--vscode-foreground', '#cccccc'),
    muted: v('--vscode-descriptionForeground', '#9d9d9d'),
    nodeBg: v('--vscode-editorWidget-background', '#252526'),
    border: v('--vscode-panel-border', '#80808059'),
    edge: v('--vscode-editorLineNumber-foreground', '#858585'),
    added: '#2ea043',
    removed: '#f85149',
    modified: '#d29922',
  };
}

async function rasterize(svg: string, width: number, height: number): Promise<string> {
  const scale = pngScale(width, height);
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = Math.floor(width * scale);
  canvas.height = Math.floor(height * scale);
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.drawImage(img, 0, 0, width, height);
  const url = canvas.toDataURL('image/png');
  if (!url.startsWith('data:image/png')) throw new Error('graph too large for PNG; use SVG instead');
  return url;
}

/** Export what is currently visible (whole canvas, not just the viewport): PNG, SVG or Mermaid. */
export function ExportPanel(props: {
  nodes: PayloadNode[];
  edges: PayloadEdge[];
  layout: Positioned;
  vertical: boolean;
  colored: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const run = async (format: 'png' | 'svg' | 'mermaid') => {
    setBusy(true);
    setFailed(null);
    try {
      let data: string;
      if (format === 'mermaid')
        data = toMermaid(props.nodes, props.edges, props.vertical ? 'TB' : 'LR', props.colored);
      else {
        const { svg, width, height } = toSvg(
          props.nodes,
          props.edges,
          props.layout,
          props.vertical,
          props.colored,
          themeColors(),
        );
        data =
          format === 'svg'
            ? `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
            : await rasterize(svg, width, height);
      }
      vscode.postMessage({ type: 'export', format, data });
    } catch (e) {
      setFailed(`${format.toUpperCase()} export failed: ${e instanceof Error ? e.message : String(e)}`);
      vscode.postMessage({ type: 'error', message: `export ${format} failed: ${String(e)}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Panel position="top-right" className="fl-export">
      {(['png', 'svg', 'mermaid'] as const).map((f) => (
        <button
          key={f}
          disabled={busy}
          onClick={() => run(f)}
          title={`Export visible graph as ${f.toUpperCase()}`}
        >
          {f === 'mermaid' ? 'Mermaid' : f.toUpperCase()}
        </button>
      ))}
      {failed && (
        <p className="fl-warn" role="alert">
          {failed}
        </p>
      )}
    </Panel>
  );
}
