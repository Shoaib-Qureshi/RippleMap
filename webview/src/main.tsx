import { createRoot } from 'react-dom/client';
import type { HostToWebview } from '../../src/shared/messages';
import { App } from './App';
import { ErrorBoundary } from './components/ErrorBoundary';
import { useStore } from './store';
import { vscode } from './vscode';
import './index.css';

window.addEventListener('message', (e: MessageEvent<HostToWebview>) => useStore.getState().receive(e.data));
const report = (e: unknown) =>
  vscode.postMessage({
    type: 'error',
    message: e instanceof Error ? `${e.message}\n${e.stack ?? ''}` : String(e),
  });
window.addEventListener('error', (e) => report(e.error ?? e.message));
window.addEventListener('unhandledrejection', (e) => report(e.reason));
// The boundary reports errors it catches; the root callback covers anything outside it.
createRoot(document.getElementById('root')!, { onUncaughtError: report }).render(
  <ErrorBoundary onError={report}>
    <App />
  </ErrorBoundary>,
);
vscode.postMessage({ type: 'ready' });
