import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { isWebviewMessage, type HostToWebview } from '../shared/messages';

/** Hosts the single FlowLens webview panel. The host owns state; the webview only renders it. */
export class PanelProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readyWaiters: (() => void)[] = [];

  constructor(private readonly ctx: vscode.ExtensionContext) {}

  /** Opens (or reveals) the panel. Resolves once the webview has sent `ready` and received `init`. */
  open(): Promise<void> {
    if (this.panel) {
      this.panel.reveal();
      return Promise.resolve();
    }
    const root = vscode.Uri.joinPath(this.ctx.extensionUri, 'dist', 'webview');
    const panel = vscode.window.createWebviewPanel('flowlens.panel', 'FlowLens', vscode.ViewColumn.Beside, {
      enableScripts: true,
      localResourceRoots: [root],
      retainContextWhenHidden: true,
    });
    this.panel = panel;
    panel.webview.html = this.html(panel.webview, root);
    panel.webview.onDidReceiveMessage((m: unknown) => {
      if (!isWebviewMessage(m)) return;
      if (m.type === 'ready') {
        this.post({
          type: 'init',
          version: String(this.ctx.extension.packageJSON.version),
          workspaceName: vscode.workspace.name ?? null,
        });
        this.readyWaiters.splice(0).forEach((resolve) => resolve());
      }
    });
    panel.onDidDispose(() => (this.panel = undefined));
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  post(msg: HostToWebview): void {
    void this.panel?.webview.postMessage(msg);
  }

  dispose(): void {
    this.panel?.dispose();
  }

  private html(webview: vscode.Webview, root: vscode.Uri): string {
    const nonce = randomBytes(16).toString('base64');
    const asset = (f: string) => webview.asWebviewUri(vscode.Uri.joinPath(root, f)).toString();
    const csp = [
      "default-src 'none'",
      `img-src ${webview.cspSource} data:`,
      `style-src ${webview.cspSource}`,
      `font-src ${webview.cspSource}`,
      `script-src 'nonce-${nonce}'`,
    ].join('; ');
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${asset('main.css')}">
<title>FlowLens</title>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="${asset('main.js')}"></script>
</body>
</html>`;
  }
}
