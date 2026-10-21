// Runs inside the Extension Development Host. Deliberately tiny: no mocha, just ordered async tests.
import * as assert from 'node:assert/strict';
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
