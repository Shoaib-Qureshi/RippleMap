import { EventEmitter } from 'node:events';
import type { GraphBuilder } from './GraphBuilder';
import { emptyGraph, type Graph } from './types';

const REBUILD_DEBOUNCE_MS = 30;

/** Current workspace graph. Coalesces rapid file updates into one rebuild. Pure (no vscode). */
export class GraphService extends EventEmitter<{ update: [] }> {
  graph: Graph = emptyGraph();
  private timer: NodeJS.Timeout | undefined;

  constructor(readonly builder: GraphBuilder) {
    super();
  }

  setFile(file: string, text: string): void {
    if (this.builder.setFile(file, text)) this.schedule();
  }

  removeFile(file: string): void {
    if (this.builder.removeFile(file)) this.schedule();
  }

  rebuildNow(): void {
    clearTimeout(this.timer);
    this.timer = undefined;
    this.graph = this.builder.build();
    this.emit('update');
  }

  /** Resolves once any scheduled rebuild has run. */
  flush(): void {
    if (this.timer) this.rebuildNow();
  }

  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.rebuildNow(), REBUILD_DEBOUNCE_MS);
  }

  dispose(): void {
    clearTimeout(this.timer);
  }
}
