import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { HostToWebview, WebviewToHost } from '../../src/shared/messages';
import { BrowserBridge } from '../../src/ui/BrowserBridge';

const req = (url: string, opts: { method?: string; body?: string; host?: string } = {}) =>
  new Promise<{ status: number; body: string; headers: http.IncomingHttpHeaders }>((resolve, reject) => {
    const u = new URL(url);
    const r = http.request(
      {
        host: '127.0.0.1',
        port: u.port,
        path: u.pathname + u.search,
        method: opts.method ?? 'GET',
        headers: opts.host ? { host: opts.host } : {},
      },
      (res) => {
        let body = '';
        res.on('data', (c) => (body += c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body, headers: res.headers }));
      },
    );
    r.on('error', reject);
    r.end(opts.body);
  });

describe('BrowserBridge', () => {
  let bridge: BrowserBridge | undefined;
  afterEach(() => bridge?.dispose());

  const make = (received: WebviewToHost[] = []) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-web-'));
    fs.writeFileSync(path.join(dir, 'main.js'), 'console.log(1)');
    bridge = new BrowserBridge({
      webviewDir: dir,
      init: (): HostToWebview => ({ type: 'init', version: 't', workspaceName: 'w', maxNodes: 10 }),
      onMessage: (m) => received.push(m),
    });
    return bridge;
  };

  it('requires the token, rejects foreign Host headers, serves the shell with a CSP', async () => {
    const b = make();
    const url = await b.url();
    const base = url.split('?')[0]!;
    expect((await req(base)).status).toBe(403);
    expect((await req(`${base}?t=wrong`)).status).toBe(403);
    expect((await req(url, { host: 'evil.example:80' })).status).toBe(403);
    const page = await req(url);
    expect(page.status).toBe(200);
    expect(page.headers['content-security-policy']).toContain("default-src 'none'");
    expect(page.body).toContain('acquireVsCodeApi');
    expect((await req(`${base}main.js`)).body).toBe('console.log(1)');
    expect((await req(`${base}../package.json`)).status).toBe(403); // only main.js/main.css are public
  });

  it('streams init + latest state on ready and forwards page messages', async () => {
    const received: WebviewToHost[] = [];
    const b = make(received);
    const url = await b.url();
    const base = url.split('?')[0]!;
    const t = new URL(url).searchParams.get('t');
    b.post({ type: 'index:progress', done: 1, total: 2 });

    const frames: string[] = [];
    const sse = http.get(`${base}events?t=${t}`, (res) => res.on('data', (c) => frames.push(String(c))));
    await new Promise((r) => setTimeout(r, 100));
    expect(b.clientCount).toBe(1);

    expect((await req(`${base}msg?t=${t}`, { method: 'POST', body: '{"type":"ready"}' })).status).toBe(204);
    expect(
      (await req(`${base}msg?t=${t}`, { method: 'POST', body: '{"type":"scrub","index":3}' })).status,
    ).toBe(204);
    expect((await req(`${base}msg?t=${t}`, { method: 'POST', body: '{"type":"nope"}' })).status).toBe(400);
    await new Promise((r) => setTimeout(r, 100));
    const text = frames.join('');
    expect(text).toContain('"type":"init"');
    expect(text).toContain('"type":"index:progress"');
    expect(received).toEqual([{ type: 'scrub', index: 3 }]);
    sse.destroy();
  });
});
