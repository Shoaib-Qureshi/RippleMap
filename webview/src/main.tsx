import { createRoot } from 'react-dom/client';
import type { HostToWebview } from '../../src/shared/messages';
import { App } from './App';
import { useStore } from './store';
import { vscode } from './vscode';
import './index.css';

window.addEventListener('message', (e: MessageEvent<HostToWebview>) => useStore.getState().receive(e.data));
createRoot(document.getElementById('root')!).render(<App />);
vscode.postMessage({ type: 'ready' });
