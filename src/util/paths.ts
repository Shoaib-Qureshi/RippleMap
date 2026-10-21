import * as path from 'node:path';

/** Backslashes -> forward slashes. All internal paths use this form. */
export const toPosix = (p: string): string => p.replace(/\\/g, '/');

const isWinPath = (p: string) => /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\');

/**
 * Workspace-relative, forward-slash path for `abs` under `root`, or null if outside it.
 * Picks win32 semantics for Windows-style inputs (drive letters, UNC) so it is testable anywhere.
 */
export function relPath(root: string, abs: string): string | null {
  const impl = isWinPath(root) || isWinPath(abs) ? path.win32 : path.posix;
  const rel = impl.relative(root, abs);
  if (!rel || rel.startsWith('..') || impl.isAbsolute(rel)) return null;
  return toPosix(rel);
}

/** True if any folder segment of a relative path is in the excluded set (e.g. node_modules). */
export function isExcluded(rel: string, excludedFolders: ReadonlySet<string>): boolean {
  const parts = rel.split('/');
  for (let i = 0; i < parts.length - 1; i++) if (excludedFolders.has(parts[i]!)) return true;
  return false;
}

export const basename = (rel: string): string => rel.slice(rel.lastIndexOf('/') + 1);
export const dirname = (rel: string): string => (rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '');
