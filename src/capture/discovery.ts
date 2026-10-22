import { createHash } from 'node:crypto';
import * as os from 'node:os';
import * as path from 'node:path';

/** Must match hook/hook-forwarder.js (a unit test checks they agree). */
export function normalizeDir(p: string, platform = process.platform): string {
  let s = path.resolve(p).replace(/\\/g, '/').replace(/\/+$/, '');
  if (platform === 'win32') s = s.toLowerCase();
  return s || '/';
}

/**
 * Per-user folder (`flowlens-<uid>` on POSIX): /tmp is shared on Linux, and another user could otherwise
 * plant a discovery file pointing hook payloads at their own server. Windows %TEMP% is already per-user.
 */
export function discoveryDir(): string {
  const uid = typeof process.getuid === 'function' ? process.getuid() : undefined;
  return path.join(os.tmpdir(), uid === undefined ? 'flowlens' : `flowlens-${uid}`);
}

/** `<discoveryDir>/<hash>.json`: where the hook forwarder finds this window's port + token. */
export function discoveryPath(dir: string): string {
  const hash = createHash('sha256').update(normalizeDir(dir)).digest('hex').slice(0, 16);
  return path.join(discoveryDir(), `${hash}.json`);
}
