// Runs inside the Extension Development Host. Deliberately tiny: no mocha, just ordered async tests.
import * as assert from 'node:assert/strict';
import * as vscode from 'vscode';

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
