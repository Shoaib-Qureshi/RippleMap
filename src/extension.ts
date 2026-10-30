import * as fs from 'node:fs';
import * as vscode from 'vscode';
import { ActivityLog } from './capture/ActivityLog';
import { ClaudeCodeAdapter, hookReply, OUTSIDE_MARKER, type AgentNote } from './capture/ClaudeCodeAdapter';
import { CursorAdapter, isCursorPayload } from './capture/CursorAdapter';
import type { RawEdit } from './capture/EditEvent';
import { EditTracker } from './capture/EditTracker';
import { HookServer } from './capture/HookServer';
import { ManualEditAdapter } from './capture/ManualEditAdapter';
import { cleanKey, summarize } from './ai/summarize';
import { saveExport } from './commands/exportGraph';
import { FORWARDER_FILE } from './commands/hooksConfig';
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
import { ActivityProvider } from './ui/ActivityProvider';
import { EditFeedProvider } from './ui/EditFeedProvider';
import { BrowserBridge } from './ui/BrowserBridge';
import { initMessage, PanelProvider } from './ui/PanelProvider';
import { StatusBar } from './ui/StatusBar';
import type { GraphPayload, HostToWebview, Summary, WebviewToHost } from './shared/messages';
import { config, readText, toUri, trackedRel } from './util/workspace';

export interface FlowLensApi {
  tracker: EditTracker;
  /** Agent calls outside the code (MCP / web / network commands). */
  activity: ActivityLog;
  hookServer: HookServer;
  graph: GraphService;
  /** Resolves when the initial index has finished. */
  indexed: Promise<void>;
  /** Errors reported by the webview (also logged to the FlowLens output channel). */
  webviewErrors: string[];
}

const NOTES_KEY = 'flowlens.notes';
/** Same cap as readText; bigger files aren't previewed. */
const MAX_SYNC_READ = 2 * 1024 * 1024;
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
  const activity = new ActivityLog();
  const sink = {
    emit: (e: RawEdit) => void tracker.record(e),
    discard: (id?: string, session?: string) => {
      tracker.discardProposed(id, session);
      if (!id) activity.interrupt(session); // Stop: that response's unfinished calls never completed
    },
    activity: (a: Parameters<ActivityLog['record']>[0]) => void activity.record(a),
  };
  const claude = new ClaudeCodeAdapter({
    toRel: (abs) => trackedRel(vscode.Uri.file(abs)),
    read: (abs) => readText(vscode.Uri.file(abs)),
    readSync: (abs) => {
      try {
        return fs.statSync(abs).size > MAX_SYNC_READ ? undefined : fs.readFileSync(abs, 'utf8');
      } catch {
        return undefined; // missing: Write is creating it
      }
    },
  });
  const cursor = new CursorAdapter();
  // User's instructions for the agent, per graph node; sent back through the PreToolUse hook.
  let notes: Record<string, StoredNote> = ctx.workspaceState.get(NOTES_KEY) ?? {};
  // Serialize hook handling so Pre/Post for the same tool call are processed in order.
  let hookQueue = Promise.resolve();
  const hookServer = new HookServer(
    (p) =>
      isCursorPayload(p)
        ? cursor.handle(p)
        : (hookQueue = hookQueue.then(() => claude.handle(p)).catch(() => undefined)),
    (p) => {
      claude.snapshot(p);
      return hookReply(
        p,
        (abs) => trackedRel(vscode.Uri.file(abs)),
        (file) =>
          Object.entries(notes)
            .filter(([id, n]) => n.file === file && (!graph.graph.nodes.size || graph.graph.nodes.has(id)))
            .map(([, n]) => n),
      );
    },
  );

  const parser = await ParserService.create(vscode.Uri.joinPath(ctx.extensionUri, 'dist', 'grammars').fsPath);
  const graph = new GraphService(new GraphBuilder(parser, extractors), config().snapshotLimit);
  const statusBar = new StatusBar(tracker);

  const log = vscode.window.createOutputChannel('FlowLens', { log: true });
  const webviewErrors: string[] = [];
  const onViewMessage = (m: Exclude<WebviewToHost, { type: 'ready' }>) => {
    if (m.type === 'popout') {
      vscode.commands
        .executeCommand(m.target === 'browser' ? 'flowlens.openInBrowser' : 'flowlens.openInNewWindow')
        .then(undefined, (e: unknown) => void vscode.window.showErrorMessage(`FlowLens: ${String(e)}`));
    } else if (m.type === 'error') {
      if (webviewErrors.length < 100) webviewErrors.push(m.message.slice(0, 2000));
      log.error(`webview: ${m.message.slice(0, 2000)}`);
    } else if (m.type === 'export') {
      saveExport(m.format, m.data).catch(
        (e: unknown) => void vscode.window.showErrorMessage(`FlowLens: export failed: ${String(e)}`),
      );
    } else if (m.type === 'note:set') {
      const n = graph.graph.nodes.get(m.nodeId);
      const text = m.text.trim();
      if (text && !n) return; // removed / only in a pending proposal: keep what's stored
      if (text && n) notes[m.nodeId] = { file: n.file, label: n.label, kind: n.kind, text };
      else delete notes[m.nodeId];
      notes = { ...notes };
      void ctx.workspaceState.update(NOTES_KEY, notes);
      postNotes();
    } else if (m.type === 'showActivity') {
      void vscode.commands.executeCommand('flowlens.activity.focus');
    } else if (m.type === 'ai:summarize') {
      void explain(m.nodeId);
    } else if (m.type === 'scrub') {
      graph.select(m.index);
    } else if (m.type === 'openFile') {
      const uri = toUri(m.file);
      if (!uri) return;
      const line = Math.max(0, (m.line ?? 1) - 1);
      // Never on top of the graph: use a column the panel isn't in, keep focus on the graph.
      void vscode.window
        .showTextDocument(uri, {
          viewColumn:
            panel.viewColumn === vscode.ViewColumn.One ? vscode.ViewColumn.Two : vscode.ViewColumn.One,
          selection: new vscode.Range(line, 0, line, 0),
          preserveFocus: true,
          preview: true,
        })
        .then(undefined, () => void vscode.window.showWarningMessage(`FlowLens: can't open ${m.file}.`));
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
  // Agent calls outside the code, for the graph's "reached" blocks (only what the view needs).
  const postActivity = () =>
    post({
      type: 'activity',
      items: activity.items.map(({ ts, kind, target, status }) => ({ ts, kind, target, status })),
    });
  activity.on('change', postActivity);
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
      const { baseUrl, model } = config().ai;
      // The OPENROUTER_API_KEY env var only ever goes to OpenRouter, never to another configured API.
      const envKey = /^https:\/\/openrouter\.ai(\/|$)/.test(baseUrl)
        ? process.env.OPENROUTER_API_KEY
        : undefined;
      const key = (await ctx.secrets.get(AI_KEY_SECRET)) || envKey || (await promptKey());
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
    vscode.window.registerTreeDataProvider('flowlens.activity', new ActivityProvider(activity)),
    registerEditDiffView(tracker),
    new ManualEditAdapter().start(sink),
    claude.start(sink),
    cursor.start(sink),
    hookServer,
    registerHookCommands(ctx),
    vscode.workspace.onDidOpenTextDocument(seed),
    vscode.commands.registerCommand('flowlens.openPanel', () => panel.open()),
    vscode.commands.registerCommand('flowlens.openInBrowser', async () => {
      // asExternalUri: port-forwarded URL in Remote-SSH / WSL / Codespaces (same URL locally).
      const external = await vscode.env.asExternalUri(vscode.Uri.parse(await browser.url()));
      browser.allowHost(external.authority);
      const opened = await vscode.env.openExternal(external);
      if (!opened) {
        await vscode.env.clipboard.writeText(external.toString(true));
        void vscode.window.showInformationMessage('FlowLens: browser URL copied to the clipboard.');
      }
    }),
    vscode.commands.registerCommand('flowlens.openInNewWindow', async () => {
      await panel.open();
      panel.reveal();
      await vscode.commands.executeCommand('workbench.action.moveEditorToNewWindow');
    }),
    vscode.commands.registerCommand('flowlens.clearHistory', () => {
      tracker.clear();
      activity.clear();
    }),
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
  // Forget notes/explanations for nodes that no longer exist (renamed/deleted while VS Code was closed).
  void indexed.then(() => {
    const live = graph.graph.nodes;
    if (!live.size) return;
    const keep = <T>(r: Record<string, T>) =>
      Object.fromEntries(Object.entries(r).filter(([id]) => live.has(id)));
    notes = keep(notes);
    summaries = keep(summaries);
    void ctx.workspaceState.update(NOTES_KEY, notes);
    void ctx.workspaceState.update(
      SUMMARIES_KEY,
      keep(ctx.workspaceState.get<Record<string, Summary>>(SUMMARIES_KEY) ?? {}),
    );
    postNotes();
    post({ type: 'summaries', summaries });
  });
  // Folders added/removed: discovery files for the hook forwarder, and ids change (multi-root prefix): re-index.
  ctx.subscriptions.push(
    vscode.workspace.onDidChangeWorkspaceFolders((e) => {
      try {
        hookServer.addDirs(e.added.map((f) => f.uri.fsPath));
        hookServer.removeDirs(e.removed.map((f) => f.uri.fsPath));
      } catch (err) {
        void vscode.window.showWarningMessage(
          `FlowLens: hooks for new folders unavailable (${String(err)}).`,
        );
      }
      graph.builder.facts.clear();
      void runIndex('Re-index');
    }),
  );

  try {
    await hookServer.start((vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath));
  } catch (e) {
    void vscode.window.showWarningMessage(
      `FlowLens: hook server unavailable (${String(e)}); AI edits will show as manual.`,
    );
  }
  // Keep the installed hook path pointing at the current forwarder (separate: the server may be fine).
  await ensureForwarder(ctx).catch(
    (e: unknown) =>
      void vscode.window.showWarningMessage(`FlowLens: couldn't update the hook script (${String(e)}).`),
  );
  void offerHookUpdate();
  return { tracker, activity, hookServer, graph, indexed, webviewErrors };
}

/** Hooks installed before MCP/web activity existed only watch edits: offer a one-click update (never automatic). */
async function offerHookUpdate(): Promise<void> {
  for (const f of vscode.workspace.workspaceFolders ?? []) {
    let text: string;
    try {
      const raw = await vscode.workspace.fs.readFile(
        vscode.Uri.joinPath(f.uri, '.claude', 'settings.local.json'),
      );
      text = new TextDecoder().decode(raw);
    } catch {
      continue; // no settings file: nothing installed here
    }
    if (!text.includes(FORWARDER_FILE) || text.includes(OUTSIDE_MARKER)) continue;
    const pick = await vscode.window.showInformationMessage(
      'FlowLens can now show the MCP servers and websites Claude Code reaches. Update its Claude Code hooks?',
      'Update hooks',
    );
    if (pick) await vscode.commands.executeCommand('flowlens.installHooks');
    return;
  }
}

export function deactivate(): void {}
