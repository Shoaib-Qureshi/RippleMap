import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));

// Fixed output names so PanelProvider can reference them without a manifest.
export default defineConfig({
  plugins: [react()],
  build: {
    outDir: here('../dist/webview'),
    emptyOutDir: true,
    sourcemap: true,
    rollupOptions: {
      input: here('src/main.tsx'),
      output: {
        entryFileNames: 'main.js',
        assetFileNames: '[name][extname]',
      },
    },
  },
});
