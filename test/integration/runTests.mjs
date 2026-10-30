// Launches a downloaded VS Code with FlowLens loaded and runs the in-host suite.
// `--vsix <file>` runs the same suite against the unpacked .vsix instead of the source tree,
// which proves the package contains everything it needs (bundle, WASM grammars, hook forwarder).
import { runTests } from '@vscode/test-electron';
import { execFileSync } from 'node:child_process';
import * as fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
// Set when launched from a VS Code terminal; it would make the test Electron run as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;

let extensionDevelopmentPath = root;
const vsixArg = process.argv.indexOf('--vsix');
if (vsixArg !== -1) {
  const vsix = path.resolve(root, process.argv[vsixArg + 1] ?? 'flowlens.vsix');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flowlens-vsix-'));
  // A .vsix is a zip. bsdtar (macOS, Windows 10+) reads zips; GNU tar (Linux) does not, so use unzip there.
  if (process.platform === 'linux') execFileSync('unzip', ['-q', vsix, '-d', dir]);
  else execFileSync('tar', ['-xf', vsix, '-C', dir]);
  extensionDevelopmentPath = path.join(dir, 'extension');
  console.log(`Testing packaged extension from ${extensionDevelopmentPath}`);
}

try {
  await runTests({
    // Latest stable by default (CI). VSCODE_TEST_VERSION=1.143.0 reuses a cached download offline.
    version: process.env.VSCODE_TEST_VERSION || 'stable',
    extensionDevelopmentPath,
    extensionTestsPath: path.join(root, 'out', 'integration', 'suite.js'),
    launchArgs: [
      path.join(root, 'test', 'fixtures', 'workspace'),
      '--disable-extensions',
      // Short path: macOS/Linux cap Unix socket paths at ~104 chars.
      `--user-data-dir=${path.join(os.tmpdir(), 'flowlens-test')}`,
    ],
  });
} catch (err) {
  console.error('Integration tests failed:', err);
  process.exit(1);
}
