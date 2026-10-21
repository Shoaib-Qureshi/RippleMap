import * as vscode from 'vscode';

const MAX_BYTES = 25 * 1024 * 1024;
const EXT = { png: 'png', svg: 'svg', mermaid: 'mmd' } as const;

/** Saves an export produced by the webview (data URL for png/svg, text for mermaid). */
export async function saveExport(format: keyof typeof EXT, data: string): Promise<void> {
  let bytes: Uint8Array;
  if (format === 'mermaid') bytes = new TextEncoder().encode(data);
  else if (format === 'png') {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(data);
    if (!m) throw new Error('unexpected PNG data');
    bytes = Buffer.from(m[1]!, 'base64');
  } else {
    const m = /^data:image\/svg\+xml;charset=utf-8,(.*)$/s.exec(data);
    if (!m) throw new Error('unexpected SVG data');
    bytes = new TextEncoder().encode(decodeURIComponent(m[1]!));
  }
  if (bytes.byteLength > MAX_BYTES) throw new Error('export too large');
  const folder = vscode.workspace.workspaceFolders?.[0]?.uri;
  const uri = await vscode.window.showSaveDialog({
    defaultUri: folder && vscode.Uri.joinPath(folder, `flowlens-graph.${EXT[format]}`),
    filters: { [format.toUpperCase()]: [EXT[format]] },
  });
  if (!uri) return;
  await vscode.workspace.fs.writeFile(uri, bytes);
  void vscode.window.showInformationMessage(`FlowLens: exported ${vscode.workspace.asRelativePath(uri)}`);
}
