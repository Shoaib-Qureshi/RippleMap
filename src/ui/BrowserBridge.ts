import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { isWebviewMessage, type HostToWebview, type WebviewToHost } from '../shared/messages';

const MAX_BODY = 30 * 1024 * 1024; // PNG exports can be a few MB
const ASSETS: Record<string, string> = { '/main.js': 'text/javascript', '/main.css': 'text/css' };

/** Theme for the browser tab, where VS Code's CSS variables don't exist. */
const THEME = `
:root{--vscode-foreground:#cccccc;--vscode-descriptionForeground:#9d9d9d;--vscode-editor-background:#1e1e1e;--vscode-editorWidget-background:#252526;--vscode-sideBar-background:#252526;--vscode-input-background:#3c3c3c;--vscode-input-foreground:#cccccc;--vscode-input-border:#3c3c3c;--vscode-button-background:#0e639c;--vscode-button-foreground:#ffffff;--vscode-button-hoverBackground:#1177bb;--vscode-focusBorder:#007fd4;--vscode-textLink-foreground:#3794ff;--vscode-editorLineNumber-foreground:#858585;--vscode-panel-border:#80808059;--vscode-editorWarning-foreground:#cca700;--vscode-font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;--vscode-font-size:13px}
@media (prefers-color-scheme: light){:root{--vscode-foreground:#3b3b3b;--vscode-descriptionForeground:#717171;--vscode-editor-background:#ffffff;--vscode-editorWidget-background:#f3f3f3;--vscode-sideBar-background:#f3f3f3;--vscode-input-background:#ffffff;--vscode-input-foreground:#3b3b3b;--vscode-input-border:#cecece;--vscode-editorLineNumber-foreground:#6e7681;--vscode-panel-border:#e5e5e5;--vscode-editorWarning-foreground:#bf8803}}
`;

/**
 * Serves the graph UI to a normal browser tab on 127.0.0.1 (random port, secret token in the URL).
 * Host -> page: Server-Sent Events. Page -> host: POST. The React app runs unchanged: a small shim
 * provides `acquireVsCodeApi()` and turns SSE messages into window `message` events.
 */
export class BrowserBridge {
  readonly token = randomBytes(24).toString('hex');
  private server: http.Server | undefined;
  private starting: Promise<void> | undefined;
  /** Extra Host values to accept (port-forwarded URL in Remote-SSH / WSL / Codespaces). */
  private readonly hosts = new Set<string>();
  private readonly clients = new Set<http.ServerResponse>();
  private readonly latest = new Map<HostToWebview['type'], HostToWebview>();

  constructor(
    private readonly opts: {
      webviewDir: string;
      init: () => HostToWebview;
      onMessage: (m: Exclude<WebviewToHost, { type: 'ready' }>) => void;
    },
  ) {}

  get port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? 0;
  }

  get clientCount(): number {
    return this.clients.size;
  }

  /** Starts the server on first use; returns the URL to open. */
  async url(): Promise<string> {
    // One shared start: concurrent calls (double-clicks) all wait for the real port.
    this.starting ??= new Promise<void>((resolve, reject) => {
      const server = http.createServer((req, res) => this.handle(req, res));
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => {
        this.server = server;
        resolve();
      });
    }).catch((e: unknown) => {
      this.starting = undefined; // let the next call retry
      throw e;
    });
    await this.starting;
    return `http://127.0.0.1:${this.port}/?t=${this.token}`;
  }

  /** Accepts requests addressed to `authority` too (e.g. the `asExternalUri` of our URL). */
  allowHost(authority: string): void {
    this.hosts.add(authority);
  }

  post(msg: HostToWebview): void {
    this.latest.set(msg.type, msg);
    this.broadcast(msg);
  }

  dispose(): void {
    for (const c of this.clients) c.end();
    this.clients.clear();
    this.server?.close();
  }

  private broadcast(msg: HostToWebview): void {
    if (!this.clients.size) return; // nobody listening: `latest` is replayed on connect
    const frame = `data: ${JSON.stringify(msg)}\n\n`;
    for (const c of this.clients) c.write(frame);
  }

  private tokenOk(given: string | null): boolean {
    const a = Buffer.from(given ?? '');
    const b = Buffer.from(this.token);
    return a.length === b.length && timingSafeEqual(a, b);
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const end = (code: number, body = ''): void => void res.writeHead(code).end(body);
    // DNS-rebinding guard: only answer requests addressed to our own loopback origin.
    const host = req.headers.host ?? '';
    if (host !== `127.0.0.1:${this.port}` && host !== `localhost:${this.port}` && !this.hosts.has(host))
      return end(403);
    const url = new URL(req.url ?? '/', `http://127.0.0.1:${this.port}`);

    const type = ASSETS[url.pathname];
    if (req.method === 'GET' && type) {
      // Static bundle only (no workspace data in it), so no token needed.
      return void fs.readFile(path.join(this.opts.webviewDir, url.pathname.slice(1)), (err, data) =>
        err ? end(404) : res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' }).end(data),
      );
    }
    if (!this.tokenOk(url.searchParams.get('t'))) return end(403);

    if (req.method === 'GET' && url.pathname === '/') {
      const nonce = randomBytes(16).toString('base64');
      res.writeHead(200, {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
        'content-security-policy': `default-src 'none'; script-src 'self' 'nonce-${nonce}'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'`,
      });
      return void res.end(this.html(nonce));
    }
    if (req.method === 'GET' && url.pathname === '/events') {
      res.writeHead(200, {
        'content-type': 'text/event-stream',
        'cache-control': 'no-store',
        connection: 'keep-alive',
      });
      res.write('retry: 2000\n\n');
      this.clients.add(res);
      req.on('close', () => this.clients.delete(res));
      return;
    }
    if (req.method === 'POST' && url.pathname === '/msg') {
      const chunks: Buffer[] = [];
      let size = 0;
      req.on('data', (c: Buffer) => {
        size += c.length;
        if (size > MAX_BODY) {
          end(413);
          req.destroy();
        } else chunks.push(c);
      });
      req.on('end', () => {
        if (res.headersSent) return;
        let m: unknown;
        try {
          m = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        } catch {
          return end(400);
        }
        if (!isWebviewMessage(m)) return end(400);
        end(204);
        if (m.type === 'ready') {
          this.broadcast(this.opts.init());
          for (const msg of this.latest.values()) this.broadcast(msg);
        } else this.opts.onMessage(m);
      });
      return;
    }
    end(404);
  }

  private html(nonce: string): string {
    const t = this.token;
    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>RippleMap</title>
<style>${THEME}</style>
<link rel="stylesheet" href="/main.css">
<script nonce="${nonce}">
(() => {
  window.__RIPPLEMAP_BROWSER__ = true;
  const send = (m) => fetch('/msg?t=${t}', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(m) }).catch(() => {});
  window.acquireVsCodeApi = () => ({ postMessage: send });
  const es = new EventSource('/events?t=${t}');
  es.onmessage = (e) => window.dispatchEvent(new MessageEvent('message', { data: JSON.parse(e.data) }));
  // (Re)connected: ask the host for init + the latest state.
  es.onopen = () => { document.title = 'RippleMap'; send({ type: 'ready' }); };
  es.onerror = () => { document.title = 'RippleMap (disconnected - reopen from VS Code)'; };
})();
</script>
</head>
<body>
<div id="root"></div>
<script type="module" nonce="${nonce}" src="/main.js"></script>
</body>
</html>`;
  }
}
