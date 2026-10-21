import * as esbuild from 'esbuild';
import * as fs from 'node:fs';
import * as path from 'node:path';

const watch = process.argv.includes('--watch');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  external: ['vscode'],
  sourcemap: true,
  logLevel: 'info',
};

const configs = [
  { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js' },
  // In-host integration suite; never shipped (lives in out/).
  { ...common, entryPoints: ['test/integration/suite.ts'], outfile: 'out/integration/suite.js' },
];

// Tree-sitter runtime + grammars ship next to the bundle (WASM, no native modules).
const wasmSrc = 'node_modules/@vscode/tree-sitter-wasm/wasm';
fs.mkdirSync('dist/grammars', { recursive: true });
for (const f of [
  'tree-sitter.wasm',
  ...['javascript', 'typescript', 'tsx', 'php', 'python'].map((l) => `tree-sitter-${l}.wasm`),
])
  fs.copyFileSync(path.join(wasmSrc, f), path.join('dist/grammars', f));

if (watch) {
  await Promise.all(configs.map(async (c) => (await esbuild.context(c)).watch()));
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
