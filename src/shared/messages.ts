// Typed host <-> webview protocol. Shared by both bundles; keep it free of runtime deps.
import type { GraphEdge, GraphNode } from '../graph/types';

export type { GraphEdge, GraphNode, NodeKind, EdgeKind } from '../graph/types';

export type Status = 'added' | 'removed' | 'modified' | 'unchanged';
export type PayloadNode = GraphNode & { status: Status };
export type PayloadEdge = GraphEdge & { status: Status };

export interface StepInfo {
  index: number;
  id: string;
  ts: number;
  label: string;
  edits: number;
}

export interface DiffCounts {
  addedNodes: number;
  removedNodes: number;
  modifiedNodes: number;
  addedEdges: number;
  removedEdges: number;
}

/** Before+after union. Diff mode colors by status; Current hides `added`; After hides `removed`. */
export interface GraphPayload {
  nodes: PayloadNode[];
  edges: PayloadEdge[];
  summary: string;
  counts: DiffCounts;
  /** Snapshot shown as "after" (null before the first index). */
  step: StepInfo | null;
  steps: StepInfo[];
  /** Set while previewing an agent's proposed edit (diff = current vs would-be graph). */
  pending: { file: string; uncertain: boolean } | null;
  /** Risk warnings for this change: new cycles, orphaned functions, calls to removed symbols. */
  insights: { kind: 'cycle' | 'orphan' | 'dangling'; message: string; nodeIds: string[] }[];
}

export type HostToWebview =
  | { type: 'init'; version: string; workspaceName: string | null; maxNodes: number }
  | { type: 'graph:update'; graph: GraphPayload }
  | { type: 'index:progress'; done: number; total: number };

export type WebviewToHost =
  | { type: 'ready' }
  | { type: 'openFile'; file: string; line?: number }
  | { type: 'error'; message: string }
  /** Inspect snapshot `index` (null = follow latest). */
  | { type: 'scrub'; index: number | null }
  /** png/svg: data URL; mermaid: text. */
  | { type: 'export'; format: 'png' | 'svg' | 'mermaid'; data: string }
  /** Open the graph in a browser tab or a separate VS Code window. */
  | { type: 'popout'; target: 'browser' | 'window' };

const webviewTypes: ReadonlySet<string> = new Set<WebviewToHost['type']>([
  'ready',
  'openFile',
  'error',
  'scrub',
  'export',
  'popout',
]);

/** Validates messages arriving from the webview before the host acts on them. */
export function isWebviewMessage(m: unknown): m is WebviewToHost {
  if (typeof m !== 'object' || m === null) return false;
  const o = m as Record<string, unknown>;
  if (!webviewTypes.has(o.type as string)) return false;
  if (o.type === 'openFile')
    return typeof o.file === 'string' && (o.line === undefined || typeof o.line === 'number');
  if (o.type === 'error') return typeof o.message === 'string';
  if (o.type === 'popout') return o.target === 'browser' || o.target === 'window';
  if (o.type === 'export')
    return ['png', 'svg', 'mermaid'].includes(o.format as string) && typeof o.data === 'string';
  if (o.type === 'scrub')
    return o.index === null || (typeof o.index === 'number' && Number.isInteger(o.index) && o.index >= 0);
  return true;
}
