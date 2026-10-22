import * as vscode from 'vscode';
import { isExcluded, relPath } from './paths';

const MAX_FILE_BYTES = 2 * 1024 * 1024;

const folders = () => vscode.workspace.workspaceFolders ?? [];

/** Workspace-relative id for a file URI. Multi-root workspaces prefix the folder name. */
export function toRel(uri: vscode.Uri): string | null {
  if (uri.scheme !== 'file') return null;
  const folder = vscode.workspace.getWorkspaceFolder(uri);
  if (!folder) return null;
  const rel = relPath(folder.uri.fsPath, uri.fsPath);
  if (rel === null) return null;
  return folders().length > 1 ? `${folder.name}/${rel}` : rel;
}

/** URI for a workspace-relative id; undefined for anything that would leave the workspace. */
export function toUri(rel: string): vscode.Uri | undefined {
  const fs = folders();
  const parts = rel.split('/');
  if (fs.length === 0 || /^([a-z]:|\\|\/)/i.test(rel) || parts.some((p) => p === '..' || p === '.'))
    return undefined;
  if (fs.length === 1) return vscode.Uri.joinPath(fs[0]!.uri, ...parts);
  const f = fs.find((x) => x.name === parts[0]);
  return f && vscode.Uri.joinPath(f.uri, ...parts.slice(1));
}

export function config() {
  const c = vscode.workspace.getConfiguration('flowlens');
  return {
    excludeFolders: new Set(c.get<string[]>('excludeFolders', [])),
    decorationFadeSeconds: c.get<number>('decorationFadeSeconds', 60),
    maxNodes: c.get<number>('maxNodes', 1500),
    snapshotLimit: c.get<number>('snapshotLimit', 50),
    indexOnStartup: c.get<boolean>('indexOnStartup', true),
    ai: {
      baseUrl: c.get<string>('ai.baseUrl', 'https://openrouter.ai/api/v1'),
      model: c.get<string>('ai.model', 'openrouter/free'),
    },
  };
}

/** Relative path if the URI is a tracked workspace file, else null. */
export function trackedRel(uri: vscode.Uri, excluded = config().excludeFolders): string | null {
  const rel = toRel(uri);
  return rel && !isExcluded(rel, excluded) ? rel : null;
}

/** Reads a text file; undefined for missing, huge, or binary files. */
export async function readText(uri: vscode.Uri): Promise<string | undefined> {
  try {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.type !== vscode.FileType.File || stat.size > MAX_FILE_BYTES) return undefined;
    const bytes = await vscode.workspace.fs.readFile(uri);
    if (bytes.subarray(0, 8000).includes(0)) return undefined;
    return new TextDecoder().decode(bytes);
  } catch {
    return undefined;
  }
}
