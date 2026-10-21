// Typed host <-> webview protocol. Shared by both bundles; keep it free of runtime deps.
// Add message variants per milestone as features land (see ARCHITECTURE.md §8).

export type HostToWebview = { type: 'init'; version: string; workspaceName: string | null };

export type WebviewToHost = { type: 'ready' };

const webviewTypes: ReadonlySet<string> = new Set<WebviewToHost['type']>(['ready']);

/** Validates messages arriving from the webview before the host acts on them. */
export function isWebviewMessage(m: unknown): m is WebviewToHost {
  return typeof m === 'object' && m !== null && webviewTypes.has((m as { type?: unknown }).type as string);
}
