// Runs inside the Extension Development Host. Deliberately tiny: no mocha, just ordered async tests.
import * as assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vscode from 'vscode';
import type { FlowLensApi } from '../../src/extension';

const tests: [string, () => Promise<void>][] = [];
const test = (name: string, fn: () => Promise<void>) => tests.push([name, fn]);

const withTimeout = <T>(p: Thenable<T>, ms: number, what: string) =>
  Promise.race([
    Promise.resolve(p),
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`timeout: ${what}`)), ms)),
  ]);

test('openPanel completes the ready -> init round trip', async () => {
  await withTimeout(vscode.commands.executeCommand('flowlens.openPanel'), 15000, 'ready/init');
  assert.ok(true);
});

const api = async (): Promise<FlowLensApi> => {
  const ext = vscode.extensions.getExtension<FlowLensApi>('tier2.flowlens')!;
  return ext.isActive ? ext.exports : ext.activate();
};

const waitFor = async <T>(fn: () => T | undefined, what: string, ms = 5000): Promise<T> => {
  const end = Date.now() + ms;
  for (;;) {
    const v = fn();
    if (v !== undefined) return v;
    if (Date.now() > end) throw new Error(`timeout: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};

test('saving an edit creates a feed entry with +/- lines and ranges (M1)', async () => {
  const { tracker } = await api();
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, 'sample.ts');
  const doc = await vscode.workspace.openTextDocument(uri);
  const original = doc.getText();
  try {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(doc.lineCount - 1, 0), 'export const added = 1;\n');
    await vscode.workspace.applyEdit(edit);
    await doc.save();
    const e = await waitFor(() => tracker.edits.find((x) => x.file === 'sample.ts'), 'feed entry');
    assert.equal(e.status, 'applied');
    assert.equal(e.source, 'manual');
    assert.equal(e.added, 1);
    assert.equal(e.removed, 0);
    assert.deepEqual(e.changedRanges, [{ startLine: doc.lineCount - 1, endLine: doc.lineCount - 1 }]);
  } finally {
    const restore = new vscode.WorkspaceEdit();
    restore.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), original);
    await vscode.workspace.applyEdit(restore);
    await doc.save();
  }
});

const forward = (payload: object) => {
  const forwarder = path.join(
    vscode.extensions.getExtension('tier2.flowlens')!.extensionPath,
    'hook',
    'hook-forwarder.js',
  );
  const env = { ...process.env };
  delete env.CLAUDE_PROJECT_DIR;
  delete env.ELECTRON_RUN_AS_NODE;
  const t0 = Date.now();
  const r = spawnSync('node', [forwarder], { input: JSON.stringify(payload), env, encoding: 'utf8' });
  return { ...r, ms: Date.now() - t0 };
};

test('Claude Code hook payloads via the real forwarder produce proposed then applied (M2)', async () => {
  const { tracker } = await api();
  const root = vscode.workspace.workspaceFolders![0]!.uri.fsPath;
  const file = path.join(root, 'hooked.ts');
  fs.writeFileSync(file, 'export const a = 1;\n');
  await new Promise((r) => setTimeout(r, 400)); // let the watcher record the create
  const base = {
    session_id: 'sess-1234567890',
    cwd: root,
    tool_name: 'Edit',
    tool_use_id: 'toolu_1',
    tool_input: { file_path: file, old_string: 'a = 1', new_string: 'a = 2' },
  };
  try {
    const pre = forward({ ...base, hook_event_name: 'PreToolUse' });
    assert.equal(pre.status, 0);
    assert.equal(pre.stdout, '');
    assert.equal(pre.stderr, '');
    assert.ok(pre.ms < 1500, `forwarder took ${pre.ms}ms`);
    const proposed = await waitFor(
      () => tracker.edits.find((e) => e.toolUseId === 'toolu_1' && e.status === 'proposed'),
      'proposed',
    );
    assert.equal(proposed.after, 'export const a = 2;\n');
    assert.equal(fs.readFileSync(file, 'utf8'), 'export const a = 1;\n'); // nothing touched disk

    fs.writeFileSync(file, 'export const a = 2;\n');
    assert.equal(forward({ ...base, hook_event_name: 'PostToolUse', tool_response: {} }).status, 0);
    const applied = await waitFor(
      () => tracker.edits.find((e) => e.toolUseId === 'toolu_1' && e.status === 'applied'),
      'applied',
    );
    assert.equal(applied.source, 'claude-code');
    assert.equal(applied.added, 1);
    assert.equal(
      tracker.edits.filter(
        (e) =>
          e.file === 'hooked.ts' &&
          e.ts >= applied.ts - 3000 &&
          e !== applied &&
          e.source === 'manual' &&
          e.after === applied.after,
      ).length,
      0,
    );
    assert.ok(!tracker.edits.some((e) => e.toolUseId === 'toolu_1' && e.status === 'proposed'));
  } finally {
    fs.rmSync(file, { force: true });
  }
});

test('forwarder exits 0 silently when no FlowLens window is listening', async () => {
  const r = forward({ hook_event_name: 'PreToolUse', cwd: path.parse(process.cwd()).root });
  assert.equal(r.status, 0);
  assert.equal(r.stdout + r.stderr, '');
  const bad = spawnSync(
    'node',
    [path.join(vscode.extensions.getExtension('tier2.flowlens')!.extensionPath, 'hook', 'hook-forwarder.js')],
    { input: 'not json', encoding: 'utf8' },
  );
  assert.equal(bad.status, 0);
});

test('indexes the workspace into a file graph with import edges (M3)', async () => {
  const { graph, indexed, tracker } = await api();
  await indexed;
  const ids = [...graph.graph.nodes.keys()];
  assert.ok(ids.includes('main.ts::file::main.ts'), ids.join(', '));
  assert.ok(graph.graph.edges.has('main.ts::file::main.ts->sample.ts::file::sample.ts::imports'));
  // Index seeds baselines: an outside-the-editor change now gets a real diff ("sync before").
  assert.ok(tracker.knownText('untouched.ts') !== undefined);
});

test('an edit adding an import shows an added edge in the diff within 500 ms (M4)', async () => {
  const { graph, indexed } = await api();
  await indexed;
  const uri = vscode.Uri.joinPath(vscode.workspace.workspaceFolders![0]!.uri, 'untouched.ts');
  const doc = await vscode.workspace.openTextDocument(uri);
  const original = doc.getText();
  const edgeIdWanted = 'untouched.ts::file::untouched.ts->sample.ts::file::sample.ts::imports';
  try {
    const edit = new vscode.WorkspaceEdit();
    edit.insert(uri, new vscode.Position(0, 0), "import { hello } from './sample';\n");
    await vscode.workspace.applyEdit(edit);
    const t0 = Date.now();
    await doc.save();
    await waitFor(
      () => (graph.view().diff.addedEdges.includes(edgeIdWanted) ? true : undefined),
      'added edge',
      3000,
    );
    const ms = Date.now() - t0;
    assert.ok(ms < 500, `diff took ${ms}ms`);
    assert.match(graph.view().diff.summary, /Adds 1 import/);
  } finally {
    const restore = new vscode.WorkspaceEdit();
    restore.replace(uri, new vscode.Range(0, 0, doc.lineCount, 0), original);
    await vscode.workspace.applyEdit(restore);
    await doc.save();
  }
  // Removing it again shows the removed edge.
  await waitFor(
    () => (graph.view().diff.removedEdges.includes(edgeIdWanted) ? true : undefined),
    'removed edge',
    3000,
  );
});

test('webview renders the graph without runtime errors', async () => {
  const { webviewErrors } = await api();
  await vscode.commands.executeCommand('flowlens.openPanel');
  await new Promise((r) => setTimeout(r, 1500));
  assert.deepEqual(webviewErrors, []);
});

export async function run(): Promise<void> {
  const failures: string[] = [];
  for (const [name, fn] of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
    } catch (e) {
      console.error(`  ✗ ${name}\n    ${e instanceof Error ? e.stack : String(e)}`);
      failures.push(name);
    }
  }
  if (failures.length) throw new Error(`${failures.length} integration test(s) failed`);
}
