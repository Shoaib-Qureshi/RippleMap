import { EventEmitter } from 'node:events';
import { hashText } from './hash';
import type { GraphBuilder } from './GraphBuilder';
import { diffGraphs, type GraphDiff } from './GraphDiffer';
import { insights, type Insight } from './insights';
import { SnapshotStore, type Snapshot } from './SnapshotStore';
import { previewGraph, type PendingPreview } from '../preview/PendingEditPreview';
import { emptyGraph, type Graph } from './types';

const REBUILD_DEBOUNCE_MS = 30;

/** What the UI is looking at: a base graph, an after graph and their diff. */
export interface GraphView {
  base: Graph;
  after: Graph;
  diff: GraphDiff;
  /** The snapshot being shown as "after" (null before the first index). */
  step: Snapshot | null;
  stepIndex: number;
  /** Set when previewing a proposed edit: base = current graph, after = would-be graph. */
  pending: PendingPreview | null;
  insights: Insight[];
}

/**
 * Current workspace graph + snapshot history. Coalesces rapid file updates into one rebuild, and takes a
 * snapshot per rebuild caused by edits. Pure (no vscode).
 */
export class GraphService extends EventEmitter<{ update: [] }> {
  graph: Graph = emptyGraph();
  readonly snapshots: SnapshotStore;
  /** Index into snapshots.list being inspected; null = follow the latest. */
  selected: number | null = null;
  /** Latest proposed edit being previewed. ponytail: one at a time; the newest proposal wins. */
  pending: PendingPreview | null = null;
  private timer: NodeJS.Timeout | undefined;
  private pendingEdits: string[] = [];
  private pendingFiles = new Set<string>();

  constructor(
    readonly builder: GraphBuilder,
    snapshotLimit = 50,
  ) {
    super();
    this.snapshots = new SnapshotStore(snapshotLimit);
  }

  setFile(file: string, text: string, editId?: string): void {
    // Same content again (e.g. watcher and hook both report one edit): no rebuild, no empty snapshot.
    if (this.builder.facts.get(file)?.nodes[0]?.hash === hashText(text)) return;
    if (this.builder.setFile(file, text)) this.schedule(file, editId);
  }

  removeFile(file: string, editId?: string): void {
    if (this.builder.removeFile(file)) this.schedule(file, editId);
  }

  /** Rebuilds now; `label` forces a snapshot even with no edits (initial index, re-index). */
  rebuildNow(label?: string): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.graph = this.builder.build();
    const edits = this.pendingEdits.splice(0);
    const files = [...this.pendingFiles];
    this.pendingFiles.clear();
    if (label || edits.length || files.length) {
      this.snapshots.add(this.graph, label ?? editLabel(files), edits);
    }
    this.emit('update');
  }

  /** Runs any scheduled rebuild immediately. */
  flush(): void {
    if (this.timer) this.rebuildNow();
  }

  select(index: number | null): void {
    const n = this.snapshots.list.length;
    this.selected = index === null || index >= n - 1 ? null : Math.max(0, index);
    this.emit('update');
  }

  setPending(p: Omit<PendingPreview, 'graph' | 'facts'>, text: string | undefined): void {
    this.flush(); // preview against an up-to-date current graph
    this.pending = { ...p, ...previewGraph(this.builder, p.file, text) };
    this.emit('update');
  }

  /** Drops the preview (all, or only if it matches the edit / tool call). Returns true if it was cleared. */
  clearPending(match?: { editId?: string; toolUseId?: string; file?: string }): boolean {
    const p = this.pending;
    if (!p) return false;
    if (
      match &&
      !(
        match.editId === p.editId ||
        (match.toolUseId && match.toolUseId === p.toolUseId) ||
        match.file === p.file
      )
    )
      return false;
    this.pending = null;
    this.emit('update');
    return true;
  }

  view(): GraphView {
    // Scrubbing history wins over a live preview.
    if (this.pending && this.selected === null) {
      const d = diffGraphs(this.graph, this.pending.graph);
      const latest = this.snapshots.latest ?? null;
      return {
        base: this.graph,
        after: this.pending.graph,
        diff: d,
        step: latest,
        stepIndex: this.snapshots.list.length - 1,
        pending: this.pending,
        insights: insights(this.graph, this.pending.graph, d, this.pending.facts),
      };
    }
    const list = this.snapshots.list;
    const i = this.selected ?? list.length - 1;
    const step = list[i] ?? null;
    const after = step?.graph ?? this.graph;
    const base = list[i - 1]?.graph ?? after;
    const diff = diffGraphs(base, after);
    // Dangling-call check needs current facts, which only match the latest snapshot.
    const facts = i === list.length - 1 || list.length === 0 ? this.builder.facts : undefined;
    return {
      base,
      after,
      diff,
      step,
      stepIndex: i,
      pending: null,
      insights: insights(base, after, diff, facts),
    };
  }

  private schedule(file: string, editId?: string): void {
    this.pendingFiles.add(file);
    if (editId) this.pendingEdits.push(editId);
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rebuildNow(), REBUILD_DEBOUNCE_MS);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}

function editLabel(files: string[]): string {
  const names = files.map((f) => f.slice(f.lastIndexOf('/') + 1));
  return names.length <= 2 ? `Edit ${names.join(', ')}` : `Edit ${names[0]} +${names.length - 1} files`;
}
