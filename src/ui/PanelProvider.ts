import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { isWebviewMessage, type HostToWebview, type WebviewToHost } from '../shared/messages';
import { config } from '../util/workspace';

const THROTTLE_MS = 100; // ~10 Hz max for repeated message types

/** First message every view (panel or browser tab) receives. */
export const initMessage = (ctx: vscode.ExtensionContext): HostToWebview => ({
  type: 'init',
  version: String(ctx.extension.packageJSON.version),
  workspaceName: vscode.workspace.name ?? null,
  maxNodes: config().maxNodes,
});

/** Hosts the single FlowLens webview panel. The host owns state; the webview only renders it. */
export class PanelProvider implements vscode.Disposable {
  private panel: vscode.WebviewPanel | undefined;
  private readyWaiters: (() => void)[] = [];
  /** Latest message per type: replayed when the webview (re)loads, throttled while it is open. */
  private readonly latest = new Map<HostToWebview['type'], HostToWebview>();
  private readonly timers = new Map<HostToWebview['type'], NodeJS.Timeout>();

  constructor(
    private readonly ctx: vscode.ExtensionContext,
    private readonly onMessage: (m: Exclude<WebviewToHost, { type: 'ready' }>) => void,
  ) {}

  get isOpen(): boolean {
    return !!this.panel;
  }

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
    panel.iconPath = vscode.Uri.joinPath(this.ctx.extensionUri, 'media', 'icon.svg');
    this.panel = panel;
    panel.webview.html = this.html(panel.webview, root);
    panel.webview.onDidReceiveMessage((m: unknown) => {
      if (!isWebviewMessage(m)) return;
      if (m.type !== 'ready') return this.onMessage(m);
      void panel.webview.postMessage(initMessage(this.ctx));
      for (const msg of this.latest.values()) void panel.webview.postMessage(msg);
      this.readyWaiters.splice(0).forEach((resolve) => resolve());
    });
    panel.onDidDispose(() => {
      this.panel = undefined;
      this.readyWaiters.splice(0).forEach((resolve) => resolve()); // closed before it loaded
    });
    return new Promise((resolve) => this.readyWaiters.push(resolve));
  }

  /** Editor column the panel is in (undefined when closed). */
  get viewColumn(): vscode.ViewColumn | undefined {
    return this.panel?.viewColumn;
  }

  /** Focuses the panel (so editor commands like "move to new window" act on it). */
  reveal(): void {
    this.panel?.reveal(undefined, false);
  }

  post(msg: HostToWebview): void {
    this.latest.set(msg.type, msg);
    if (!this.panel || this.timers.has(msg.type)) return;
    this.send(msg.type);
    this.timers.set(
      msg.type,
      setTimeout(() => {
        this.timers.delete(msg.type);
        if (this.latest.get(msg.type) !== msg) this.send(msg.type);
      }, THROTTLE_MS),
    );
  }

  private send(type: HostToWebview['type']): void {
    const msg = this.latest.get(type);
    if (msg) void this.panel?.webview.postMessage(msg);
  }

  dispose(): void {
    this.timers.forEach(clearTimeout);
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
