import * as vscode from 'vscode';
import type { RawEdit } from './capture/EditEvent';
import { EditTracker } from './capture/EditTracker';
import { ClaudeCodeAdapter } from './capture/ClaudeCodeAdapter';
import { HookServer } from './capture/HookServer';
import { ManualEditAdapter } from './capture/ManualEditAdapter';
import { ensureForwarder, registerHookCommands } from './commands/installHooks';
import { Decorations } from './ui/Decorations';
import { EditFeedProvider } from './ui/EditFeedProvider';
import { registerEditDiffView } from './ui/EditDiffView';
import { PanelProvider } from './ui/PanelProvider';
import { StatusBar } from './ui/StatusBar';
import { readText, trackedRel } from './util/workspace';

export interface FlowLensApi {
  tracker: EditTracker;
  hookServer: HookServer;
}

export async function activate(ctx: vscode.ExtensionContext): Promise<FlowLensApi> {
  const tracker = new EditTracker();
  const sink = {
    emit: (e: RawEdit) => void tracker.record(e),
    discard: (id?: string) => void tracker.discardProposed(id),
  };
  const claude = new ClaudeCodeAdapter({
    toRel: (abs) => trackedRel(vscode.Uri.file(abs)),
    read: (abs) => readText(vscode.Uri.file(abs)),
  });
  // Serialize hook handling so Pre/Post for the same tool call are processed in order.
  let hookQueue = Promise.resolve();
  const hookServer = new HookServer(
    (p) => (hookQueue = hookQueue.then(() => claude.handle(p)).catch(() => undefined)),
  );
  const panel = new PanelProvider(ctx);

  // Open documents give us a free baseline, so their first save shows a real diff.
  const seed = (doc: vscode.TextDocument) => {
    const rel = trackedRel(doc.uri);
    if (rel) tracker.seed(rel, doc.getText());
  };
  vscode.workspace.textDocuments.forEach(seed);

  ctx.subscriptions.push(
    panel,
    new StatusBar(tracker),
    new Decorations(tracker),
    vscode.window.registerTreeDataProvider('flowlens.editFeed', new EditFeedProvider(tracker)),
    registerEditDiffView(tracker),
    new ManualEditAdapter().start(sink),
    claude.start(sink),
    hookServer,
    registerHookCommands(ctx),
    vscode.workspace.onDidOpenTextDocument(seed),
    vscode.commands.registerCommand('flowlens.openPanel', () => panel.open()),
    vscode.commands.registerCommand('flowlens.clearHistory', () => tracker.clear()),
  );
  try {
    await hookServer.start((vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath));
    await ensureForwarder(ctx); // keep the installed hook path pointing at the current forwarder
  } catch (e) {
    void vscode.window.showWarningMessage(
      `FlowLens: hook server unavailable (${String(e)}); AI edits will show as manual.`,
    );
  }
  return { tracker, hookServer };
}

export function deactivate(): void {}
