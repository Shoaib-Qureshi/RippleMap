import * as vscode from 'vscode';
import { FORWARDER_FILE, forwarderCommand, mergeHooks, removeHooks } from './hooksConfig';

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
  folder: vscode.WorkspaceFolder,
  change: (s: Record<string, unknown>) => Record<string, unknown>,
) {
  const dir = vscode.Uri.joinPath(folder.uri, '.claude');
  const file = vscode.Uri.joinPath(dir, 'settings.local.json');
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
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    await vscode.workspace.fs.writeFile(
      vscode.Uri.joinPath(dir, `settings.local.json.flowlens-backup-${stamp}`),
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
  const run = async (install: boolean) => {
    const folders = vscode.workspace.workspaceFolders ?? [];
    if (!folders.length) return void vscode.window.showWarningMessage('FlowLens: open a folder first.');
    try {
      const cmd = install ? forwarderCommand((await ensureForwarder(ctx)).fsPath) : '';
      const written = [];
      for (const f of folders)
        written.push(await editSettings(f, (s) => (install ? mergeHooks(s, cmd) : removeHooks(s))));
      void vscode.window.showInformationMessage(
        install
          ? `FlowLens: Claude Code hooks installed in ${written.map((u) => vscode.workspace.asRelativePath(u)).join(', ')}. Start a new Claude Code session to pick them up.`
          : 'FlowLens: Claude Code hooks removed.',
      );
    } catch (e) {
      void vscode.window.showErrorMessage(`FlowLens: ${e instanceof Error ? e.message : String(e)}`);
    }
  };
  return vscode.Disposable.from(
    vscode.commands.registerCommand('flowlens.installHooks', () => run(true)),
    vscode.commands.registerCommand('flowlens.removeHooks', () => run(false)),
  );
}
