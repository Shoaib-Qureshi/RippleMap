import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import * as path from 'node:path';
import { discoveryPath } from './discovery';

const MAX_BODY = 5 * 1024 * 1024;
export const TOKEN_HEADER = 'x-flowlens-token';

/**
 * Localhost-only receiver for hook payloads. Random port, random per-session token, size cap.
 * Responds immediately (204) so the forwarder never waits on our processing.
 */
export class HookServer {
  readonly token = randomBytes(32).toString('hex');
  private server: http.Server | undefined;
  private written: string[] = [];

  constructor(private readonly onPayload: (payload: Record<string, unknown>) => void) {}

  get port(): number {
    return (this.server?.address() as AddressInfo | null)?.port ?? 0;
  }

  async start(projectDirs: string[]): Promise<void> {
    const server = http.createServer((req, res) => this.handle(req, res));
    this.server = server;
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve());
    });
    const info = JSON.stringify({ port: this.port, token: this.token, pid: process.pid });
    for (const dir of projectDirs) {
      const file = discoveryPath(dir);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, info, { encoding: 'utf8', mode: 0o600 });
      this.written.push(file);
    }
  }

  dispose(): void {
    this.server?.close();
    for (const f of this.written) {
      try {
        // Only remove our own file: another window may have taken over the same folder.
        if (JSON.parse(fs.readFileSync(f, 'utf8')).token === this.token) fs.unlinkSync(f);
      } catch {
        /* already gone */
      }
    }
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const end = (code: number) => {
      res.writeHead(code).end();
    };
    if (req.method !== 'POST' || req.url !== '/hook') return end(404);
    const given = Buffer.from(String(req.headers[TOKEN_HEADER] ?? ''));
    const want = Buffer.from(this.token);
    if (given.length !== want.length || !timingSafeEqual(given, want)) return end(401);

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
      let payload: unknown;
      try {
        payload = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch {
        return end(400);
      }
      if (
        typeof payload !== 'object' ||
        payload === null ||
        typeof (payload as { hook_event_name?: unknown }).hook_event_name !== 'string'
      )
        return end(400);
      end(204);
      try {
        this.onPayload(payload as Record<string, unknown>);
      } catch {
        /* a bad payload must never take the server down */
      }
    });
  }
}
