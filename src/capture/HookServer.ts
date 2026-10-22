import { randomBytes, timingSafeEqual } from 'node:crypto';
import * as fs from 'node:fs';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import { discoveryDir, discoveryPath } from './discovery';

const MAX_BODY = 5 * 1024 * 1024;
export const TOKEN_HEADER = 'x-flowlens-token';

/**
 * Localhost-only receiver for hook payloads. Random port, random per-session token, size cap.
 * Responds immediately so the forwarder never waits on our processing: 204, or 200 with `reply(payload)`
 * as JSON (printed by the forwarder for the agent to read).
 */
export class HookServer {
  readonly token = randomBytes(32).toString('hex');
  private server: http.Server | undefined;
  private written: string[] = [];

  constructor(
    private readonly onPayload: (payload: Record<string, unknown>) => void,
    private readonly reply: (payload: Record<string, unknown>) => object | undefined = () => undefined,
  ) {}

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
    this.addDirs(projectDirs);
  }

  /** Writes discovery files so the forwarder finds us from these folders (also for folders added later). */
  addDirs(dirs: string[]): void {
    const info = JSON.stringify({ port: this.port, token: this.token, pid: process.pid });
    const home = discoveryDir();
    fs.mkdirSync(home, { recursive: true, mode: 0o700 });
    if (typeof process.getuid === 'function' && fs.statSync(home).uid !== process.getuid())
      throw new Error(`${home} belongs to another user; not writing hook discovery files there.`);
    for (const dir of dirs) {
      const file = discoveryPath(dir);
      fs.writeFileSync(file, info, { encoding: 'utf8', mode: 0o600 });
      if (!this.written.includes(file)) this.written.push(file);
    }
  }

  removeDirs(dirs: string[]): void {
    const files = dirs.map(discoveryPath);
    this.unlinkOwn(files);
    this.written = this.written.filter((f) => !files.includes(f));
  }

  dispose(): void {
    this.server?.close();
    this.unlinkOwn(this.written);
  }

  private unlinkOwn(files: string[]): void {
    for (const f of files) {
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
      let body: object | undefined;
      try {
        body = this.reply(payload as Record<string, unknown>);
      } catch {
        /* no reply */
      }
      if (body) res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(body));
      else end(204);
      try {
        this.onPayload(payload as Record<string, unknown>);
      } catch {
        /* a bad payload must never take the server down */
      }
    });
  }
}
