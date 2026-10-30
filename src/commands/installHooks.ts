import * as vscode from 'vscode';
import {
  FORWARDER_FILE,
  forwarderCommand,
  mergeCursorHooks,
  mergeHooks,
  removeCursorHooks,
  removeHooks,
} from './hooksConfig';

/** Where each agent keeps its hooks, relative to a workspace folder. */
const TARGETS = {
  claude: {
    dir: '.claude',
    file: 'settings.local.json',
    name: 'Claude Code',
    merge: mergeHooks,
    remove: removeHooks,
  },
  cursor: {
    dir: '.cursor',
    file: 'hooks.json',
    name: 'Cursor',
    merge: mergeCursorHooks,
    remove: removeCursorHooks,
  },
} as const;

/** Copies the forwarder to a stable location (survives extension updates) and returns its path. */
export async function ensureForwarder(ctx: vscode.ExtensionContext): Promise<vscode.Uri> {
  const target = vscode.Uri.joinPath(ctx.globalStorageUri, FORWARDER_FILE);
  await vscode.workspace.fs.createDirectory(ctx.globalStorageUri);
  await vscode.workspace.fs.copy(vscode.Uri.joinPath(ctx.extensionUri, 'hook', 'hook-forwarder.js'), target, {
    overwrite: true,
  });
  return target;
}

async function editSettings(
  ctx: vscode.ExtensionContext,
  folder: vscode.WorkspaceFolder,
  target: (typeof TARGETS)[keyof typeof TARGETS],
  change: (s: Record<string, unknown>) => Record<string, unknown>,
) {
  const dir = vscode.Uri.joinPath(folder.uri, target.dir);
  const file = vscode.Uri.joinPath(dir, target.file);
  let settings: Record<string, unknown> = {};
  let raw: Uint8Array | undefined;
  try {
    raw = await vscode.workspace.fs.readFile(file);
  } catch {
    /* no file yet */
  }
  if (raw) {
    try {
      const parsed: unknown = JSON.parse(new TextDecoder().decode(raw));
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed))
        throw new Error('not an object');
      settings = parsed as Record<string, unknown>;
    } catch (e) {
      throw new Error(`${file.fsPath} is not valid JSON (${String(e)}); not touching it.`, { cause: e });
    }
    // Backup in the extension's own storage, not the repo: these files often hold keys,
    // and a copy next to it isn't covered by the gitignore that covers the original.
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const backups = vscode.Uri.joinPath(ctx.globalStorageUri, 'settings-backups');
    await vscode.workspace.fs.createDirectory(backups);
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(
        backups,
        `${folder.name.replace(/[^\w.-]/g, '_')}-${target.dir.slice(1)}-${target.file}.${stamp}`,
      ),
      raw,
    );
  }
  await vscode.workspace.fs.createDirectory(dir);
  await vscode.workspace.fs.writeFile(
    file,
    new TextEncoder().encode(JSON.stringify(change(settings), null, 2) + '\n'),
  );
  return file;
}

export function registerHookCommands(ctx: vscode.ExtensionContext): vscode.Disposable {
  const run = async (agent: keyof typeof TARGETS, install: boolean) => {
    const target = TARGETS[agent];
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) return void vscode.window.showWarningMessage('FlowLens: open a folder first.');
    try {
      const cmd = install ? forwarderCommand((await ensureForwarder(ctx)).fsPath) : '';
      const written = [];
      for (const f of folders)
        written.push(
          await editSettings(ctx, f, target, (s) => (install ? target.merge(s, cmd) : target.remove(s))),
        );
      void vscode.window.showInformationMessage(
        install
          ? `FlowLens: ${target.name} hooks installed in ${written.map((u) => vscode.workspace.asRelativePath(u)).join(', ')}. Start a new ${target.name} agent session to pick them up.`
          : `FlowLens: ${target.name} hooks removed.`,
      );
    } catch (e) {
      void vscode.window.showErrorMessage(`FlowLens: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return vscode.Disposable.from(
    vscode.commands.registerCommand('flowlens.installHooks', () => run('claude', true)),
    vscode.commands.registerCommand('flowlens.removeHooks', () => run('claude', false)),
    vscode.commands.registerCommand('flowlens.installCursorHooks', () => run('cursor', true)),
    vscode.commands.registerCommand('flowlens.removeCursorHooks', () => run('cursor', false)),
  );
}
