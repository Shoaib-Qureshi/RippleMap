// Launches a downloaded VS Code with FlowLens loaded and runs the in-host suite.
import { runTests } from '@vscode/test-electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';

const root = path.resolve(fileURLToPath(new URL('../..', import.meta.url)));
// Set when launched from a VS Code terminal; it would make the test Electron run as plain Node.
delete process.env.ELECTRON_RUN_AS_NODE;
try {
  await runTests({
    extensionDevelopmentPath: root,
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
