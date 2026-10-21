// Typed host <-> webview protocol. Shared by both bundles; keep it free of runtime deps.
import type { GraphEdge, GraphNode } from '../graph/types';

export type { GraphEdge, GraphNode, NodeKind, EdgeKind } from '../graph/types';

export interface GraphPayload {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export type HostToWebview =
  | { type: 'init'; version: string; workspaceName: string | null; maxNodes: number }
  | { type: 'graph:update'; graph: GraphPayload }
  | { type: 'index:progress'; done: number; total: number };

export type WebviewToHost =
  { type: 'ready' } | { type: 'openFile'; file: string; line?: number } | { type: 'error'; message: string };

const webviewTypes: ReadonlySet<string> = new Set<WebviewToHost['type']>(['ready', 'openFile', 'error']);

/** Validates messages arriving from the webview before the host acts on them. */
export function isWebviewMessage(m: unknown): m is WebviewToHost {
  if (typeof m !== 'object' || m === null) return false;
  const o = m as Record<string, unknown>;
  if (!webviewTypes.has(o.type as string)) return false;
  if (o.type === 'openFile')
    return typeof o.file === 'string' && (o.line === undefined || typeof o.line === 'number');
  if (o.type === 'error') return typeof o.message === 'string';
  return true;
}
