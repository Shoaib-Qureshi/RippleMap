import * as vscode from 'vscode';
import { ClaudeCodeAdapter } from './capture/ClaudeCodeAdapter';
import type { RawEdit } from './capture/EditEvent';
import { EditTracker } from './capture/EditTracker';
import { HookServer } from './capture/HookServer';
import { ManualEditAdapter } from './capture/ManualEditAdapter';
import { ensureForwarder, registerHookCommands } from './commands/installHooks';
import { extractors } from './graph/extractors';
import { GraphBuilder } from './graph/GraphBuilder';
import { GraphService } from './graph/GraphService';
import { indexWorkspace } from './graph/Indexer';
import { serialize } from './graph/types';
import { ParserService } from './parse/ParserService';
import { Decorations } from './ui/Decorations';
import { registerEditDiffView } from './ui/EditDiffView';
import { EditFeedProvider } from './ui/EditFeedProvider';
import { PanelProvider } from './ui/PanelProvider';
import { StatusBar } from './ui/StatusBar';
import { config, readText, toUri, trackedRel } from './util/workspace';

export interface FlowLensApi {
  tracker: EditTracker;
  hookServer: HookServer;
  graph: GraphService;
  /** Resolves when the initial index has finished. */
  indexed: Promise<void>;
  /** Errors reported by the webview (also logged to the FlowLens output channel). */
  webviewErrors: string[];
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

  const parser = await ParserService.create(vscode.Uri.joinPath(ctx.extensionUri, 'dist', 'grammars').fsPath);
  const graph = new GraphService(new GraphBuilder(parser, extractors));

  const log = vscode.window.createOutputChannel('FlowLens', { log: true });
  const webviewErrors: string[] = [];
  const panel = new PanelProvider(ctx, (m) => {
    if (m.type === 'error') {
      webviewErrors.push(m.message);
      log.error(`webview: ${m.message}`);
    } else if (m.type === 'openFile') {
      const uri = toUri(m.file);
      if (!uri) return;
      const line = Math.max(0, (m.line ?? 1) - 1);
      void vscode.window.showTextDocument(uri, {
        viewColumn: vscode.ViewColumn.One,
        selection: new vscode.Range(line, 0, line, 0),
      });
    }
  });
  graph.on('update', () => panel.post({ type: 'graph:update', graph: serialize(graph.graph) }));

  tracker.on('applied', (e) => {
    if (e.kind === 'delete') graph.removeFile(e.file);
    else if (e.after !== undefined) graph.setFile(e.file, e.after);
  });

  // Open documents give us a free baseline, so their first save shows a real diff.
  const seed = (doc: vscode.TextDocument) => {
    const rel = trackedRel(doc.uri);
    if (rel) tracker.seed(rel, doc.getText());
  };
  vscode.workspace.textDocuments.forEach(seed);

  ctx.subscriptions.push(
    log,
    panel,
    graph,
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
    vscode.commands.registerCommand('flowlens.reindex', () => runIndex()),
  );

  const runIndex = () =>
    indexWorkspace(graph, tracker, (done, total) => panel.post({ type: 'index:progress', done, total })).then(
      () => undefined,
      (e: unknown) => void vscode.window.showErrorMessage(`FlowLens: indexing failed: ${String(e)}`),
    );
  const indexed = config().indexOnStartup ? runIndex() : Promise.resolve();

  try {
    await hookServer.start((vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath));
    await ensureForwarder(ctx); // keep the installed hook path pointing at the current forwarder
  } catch (e) {
    void vscode.window.showWarningMessage(
      `FlowLens: hook server unavailable (${String(e)}); AI edits will show as manual.`,
    );
  }
  return { tracker, hookServer, graph, indexed, webviewErrors };
}

export function deactivate(): void {}
