import type { Graph } from './types';

export interface Snapshot {
  id: string;
  ts: number;
  label: string;
  editIds: string[];
  graph: Graph;
}

/**
 * Ring buffer of graph snapshots (oldest dropped first). Unchanged edges reuse the previous snapshot's
 * objects, so each snapshot costs roughly the Map overhead plus what actually changed.
 * ponytail: in-memory only (not persisted to workspaceState); persist if history across reloads matters.
 */
export class SnapshotStore {
  readonly list: Snapshot[] = [];
  private seq = 0;

  constructor(private readonly limit = 50) {}

  add(graph: Graph, label: string, editIds: string[] = [], ts = Date.now()): Snapshot {
    const prev = this.list[this.list.length - 1]?.graph;
    if (prev) {
      for (const [id, e] of graph.edges) {
        const p = prev.edges.get(id);
        if (p && p.confidence === e.confidence) graph.edges.set(id, p);
      }
    }
    const snap: Snapshot = { id: `s${++this.seq}`, ts, label, editIds, graph };
    this.list.push(snap);
    if (this.list.length > this.limit) this.list.splice(0, this.list.length - this.limit);
    return snap;
  }

  get latest(): Snapshot | undefined {
    return this.list[this.list.length - 1];
  }

  clear(): void {
    this.list.length = 0;
  }
}
