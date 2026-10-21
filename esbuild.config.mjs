import * as esbuild from 'esbuild';

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

if (watch) {
  await Promise.all(configs.map(async (c) => (await esbuild.context(c)).watch()));
} else {
  await Promise.all(configs.map((c) => esbuild.build(c)));
}
