import * as vscode from 'vscode';
import { ClaudeCodeAdapter, hookReply, type AgentNote } from './capture/ClaudeCodeAdapter';
import type { RawEdit } from './capture/EditEvent';
import { EditTracker } from './capture/EditTracker';
import { HookServer } from './capture/HookServer';
import { ManualEditAdapter } from './capture/ManualEditAdapter';
import { cleanKey, summarize } from './ai/summarize';
import { saveExport } from './commands/exportGraph';
import { ensureForwarder, registerHookCommands } from './commands/installHooks';
import { extractors } from './graph/extractors';
import { GraphBuilder } from './graph/GraphBuilder';
import { GraphService } from './graph/GraphService';
import { indexWorkspace } from './graph/Indexer';
import { shortStats } from './graph/GraphDiffer';
import { toPayload } from './graph/payload';
import { touchedSymbols } from './graph/symbols';
import { ParserService } from './parse/ParserService';
import { Decorations } from './ui/Decorations';
import { registerEditDiffView } from './ui/EditDiffView';
import { EditFeedProvider } from './ui/EditFeedProvider';
import { BrowserBridge } from './ui/BrowserBridge';
import { initMessage, PanelProvider } from './ui/PanelProvider';
import { StatusBar } from './ui/StatusBar';
import type { GraphPayload, HostToWebview, Summary, WebviewToHost } from './shared/messages';
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

const NOTES_KEY = 'flowlens.notes';
const SUMMARIES_KEY = 'flowlens.summaries';
const AI_KEY_SECRET = 'flowlens.aiKey';
type StoredNote = AgentNote & { file: string };
const AGENT_NAME: Record<string, string> = {
  'claude-code': 'Claude Code',
  manual: 'Manual edit',
  'other-agent': 'Agent',
};

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
  // User's instructions for the agent, per graph node; sent back through the PreToolUse hook.
  let notes: Record<string, StoredNote> = ctx.workspaceState.get(NOTES_KEY) ?? {};
  // Serialize hook handling so Pre/Post for the same tool call are processed in order.
  let hookQueue = Promise.resolve();
  const hookServer = new HookServer(
    (p) => (hookQueue = hookQueue.then(() => claude.handle(p)).catch(() => undefined)),
    (p) =>
      hookReply(
        p,
        (abs) => trackedRel(vscode.Uri.file(abs)),
        (file) => Object.values(notes).filter((n) => n.file === file),
      ),
  );

  const parser = await ParserService.create(vscode.Uri.joinPath(ctx.extensionUri, 'dist', 'grammars').fsPath);
  const graph = new GraphService(new GraphBuilder(parser, extractors), config().snapshotLimit);
  const statusBar = new StatusBar(tracker);

  const log = vscode.window.createOutputChannel('FlowLens', { log: true });
  const webviewErrors: string[] = [];
  const onViewMessage = (m: Exclude<WebviewToHost, { type: 'ready' }>) => {
    if (m.type === 'popout') {
      void vscode.commands.executeCommand(
        m.target === 'browser' ? 'flowlens.openInBrowser' : 'flowlens.openInNewWindow',
      );
    } else if (m.type === 'error') {
      webviewErrors.push(m.message);
      log.error(`webview: ${m.message}`);
    } else if (m.type === 'export') {
      saveExport(m.format, m.data).catch(
        (e: unknown) => void vscode.window.showErrorMessage(`FlowLens: export failed: ${String(e)}`),
      );
    } else if (m.type === 'note:set') {
      const n = graph.graph.nodes.get(m.nodeId);
      const text = m.text.trim();
      if (text && n) notes[m.nodeId] = { file: n.file, label: n.label, kind: n.kind, text };
      else delete notes[m.nodeId];
      notes = { ...notes };
      void ctx.workspaceState.update(NOTES_KEY, notes);
      postNotes();
    } else if (m.type === 'ai:summarize') {
      void explain(m.nodeId);
    } else if (m.type === 'scrub') {
      graph.select(m.index);
    } else if (m.type === 'openFile') {
      const uri = toUri(m.file);
      if (!uri) return;
      const line = Math.max(0, (m.line ?? 1) - 1);
      // Never on top of the graph: use a column the panel isn't in, keep focus on the graph.
      void vscode.window.showTextDocument(uri, {
        viewColumn:
          panel.viewColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One,
        selection: new vscode.Range(line, 0, line, 0),
        preserveFocus: true,
        preview: true,
      });
    }
  };
  const panel = new PanelProvider(ctx, onViewMessage);
  const browser = new BrowserBridge({
    webviewDir: vscode.Uri.joinPath(ctx.extensionUri, 'dist', 'webview').fsPath,
    init: () => initMessage(ctx),
    onMessage: onViewMessage,
  });
  /** Every view (VS Code panel and any browser tabs) gets the same messages. */
  const post = (m: HostToWebview) => {
    panel.post(m);
    browser.post(m);
  };
  const postNotes = () =>
    post({ type: 'notes', notes: Object.fromEntries(Object.entries(notes).map(([id, n]) => [id, n.text])) });
  postNotes();

  // Opt-in AI explanations (the only network call; made when the user clicks "Explain with AI").
  let summaries: Record<string, Summary> = ctx.workspaceState.get(SUMMARIES_KEY) ?? {};
  const setSummary = (id: string, s: Summary) => {
    summaries = { ...summaries, [id]: s };
    const saved = Object.entries(summaries).filter(([, v]) => v.text);
    void ctx.workspaceState.update(
      SUMMARIES_KEY,
      Object.fromEntries(saved.map(([k, v]) => [k, { text: v.text, hash: v.hash }])),
    );
    post({ type: 'summaries', summaries });
  };
  post({ type: 'summaries', summaries });
  const promptKey = async (): Promise<string | undefined> => {
    const k = await vscode.window.showInputBox({
      title: 'FlowLens: AI API key',
      prompt:
        'OpenRouter (or other OpenAI-compatible) API key. Stored in VS Code secret storage. Empty = remove.',
      password: true,
      ignoreFocusOut: true,
    });
    if (k === undefined) return undefined;
    const key = cleanKey(k);
    if (key) await ctx.secrets.store(AI_KEY_SECRET, key);
    else await ctx.secrets.delete(AI_KEY_SECRET);
    return key || undefined;
  };
  const explain = async (nodeId: string) => {
    const n = graph.graph.nodes.get(nodeId);
    const uri = n && toUri(n.file);
    if (!n || !uri) return;
    const prev = summaries[nodeId];
    setSummary(nodeId, { ...prev, loading: true, error: undefined });
    try {
      // `||`: an empty stored/env value falls through to the prompt.
      const key =
        (await ctx.secrets.get(AI_KEY_SECRET)) || process.env.OPENROUTER_API_KEY || (await promptKey());
      if (!key) throw new Error('No API key set. Run "FlowLens: Set AI API Key".');
      const text = await readText(uri);
      if (text === undefined) throw new Error(`Can't read ${n.file}.`);
      const code =
        n.kind === 'file' || !n.range
          ? text
          : text
              .split(/\r?\n/)
              .slice(n.range.startLine - 1, n.range.endLine)
              .join('\n');
      const { baseUrl, model } = config().ai;
      const out = await summarize(
        { baseUrl, model, key },
        { file: n.file, symbol: n.kind === 'file' ? undefined : n.label, code },
      );
      setSummary(nodeId, { text: out, hash: n.hash });
    } catch (e) {
      setSummary(nodeId, { ...prev, loading: false, error: e instanceof Error ? e.message : String(e) });
    }
  };
  /** Who made the change on screen: the pending proposal's agent, else the agents behind the step's edits. */
  const agentOf = (view: ReturnType<GraphService['view']>): string | null => {
    const ids = view.pending ? [view.pending.editId] : (view.step?.editIds ?? []);
    const names = new Set(
      ids
        .map((id) => tracker.get(id)?.source)
        .filter(Boolean)
        .map((s) => AGENT_NAME[s!]),
    );
    return names.size ? [...names].join(' + ') : null;
  };
  graph.on('update', () => {
    const view = graph.view();
    statusBar.setGraphText(shortStats(view.diff));
    // Fill in "symbols touched" for the edits behind the newest snapshot (shown in the feed).
    if (graph.selected === null && view.step) {
      let changed = false;
      for (const id of view.step.editIds) {
        const e = tracker.get(id);
        if (e && !e.symbols) {
          e.symbols = touchedSymbols(e, view);
          changed = true;
        }
      }
      if (changed) tracker.emit('change');
    }
    const payload: GraphPayload = { ...toPayload(view, graph.snapshots.list), agent: agentOf(view) };
    post({ type: 'graph:update', graph: payload });
  });

  tracker.on('proposed', (e) => {
    graph.setPending(
      { editId: e.id, toolUseId: e.toolUseId, file: e.file, uncertain: !!e.uncertain },
      e.after,
    );
  });
  tracker.on('cleared', () => graph.clearPending());
  tracker.on('discarded', (dropped) => dropped.forEach((e) => graph.clearPending({ editId: e.id })));
  tracker.on('applied', (e) => {
    graph.clearPending({ toolUseId: e.toolUseId, file: e.file });
    if (e.kind === 'delete') graph.removeFile(e.file, e.id);
    else if (e.after !== undefined) graph.setFile(e.file, e.after, e.id);
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
    browser,
    graph,
    statusBar,
    new Decorations(tracker),
    vscode.window.registerTreeDataProvider('flowlens.editFeed', new EditFeedProvider(tracker)),
    registerEditDiffView(tracker),
    new ManualEditAdapter().start(sink),
    claude.start(sink),
    hookServer,
    registerHookCommands(ctx),
    vscode.workspace.onDidOpenTextDocument(seed),
    vscode.commands.registerCommand('flowlens.openPanel', () => panel.open()),
    vscode.commands.registerCommand('flowlens.openInBrowser', async () => {
      const url = await browser.url();
      const opened = await vscode.env.openExternal(vscode.Uri.parse(url));
      if (!opened) {
        await vscode.env.clipboard.writeText(url);
        void vscode.window.showInformationMessage('FlowLens: browser URL copied to the clipboard.');
      }
    }),
    vscode.commands.registerCommand('flowlens.openInNewWindow', async () => {
      await panel.open();
      panel.reveal();
      await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
    }),
    vscode.commands.registerCommand('flowlens.clearHistory', () => tracker.clear()),
    vscode.commands.registerCommand('flowlens.setAiKey', async () => {
      if ((await promptKey()) !== undefined)
        void vscode.window.showInformationMessage('FlowLens: AI key saved in VS Code secret storage.');
    }),
    vscode.commands.registerCommand('flowlens.reindex', () => runIndex('Re-index')),
  );

  const runIndex = (label = 'Initial index') =>
    indexWorkspace(graph, tracker, label, (done, total) =>
      post({ type: 'index:progress', done, total }),
    ).then(
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
