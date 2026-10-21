import type { WebviewToHost } from '../../src/shared/messages';

interface VsCodeApi {
  postMessage(msg: WebviewToHost): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

// acquireVsCodeApi may only be called once per webview lifetime.
export const vscode = acquireVsCodeApi();

/** True when served to a normal browser tab by BrowserBridge (not inside VS Code). */
export const inBrowser = (window as { __FLOWLENS_BROWSER__?: boolean }).__FLOWLENS_BROWSER__ === true;
