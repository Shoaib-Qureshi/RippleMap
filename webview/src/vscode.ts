import type { WebviewToHost } from '../../src/shared/messages';

interface VsCodeApi {
  postMessage(msg: WebviewToHost): void;
}
declare function acquireVsCodeApi(): VsCodeApi;

// acquireVsCodeApi may only be called once per webview lifetime.
export const vscode = acquireVsCodeApi();
