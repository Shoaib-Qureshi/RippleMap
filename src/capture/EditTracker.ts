import { EventEmitter } from 'node:events';
import { lineDiff } from '../util/lineDiff';
import type { EditEvent, RawEdit } from './EditEvent';

const MAX_EDITS = 300;
/** A hook event and a disk/save event for the same file this close together are the same edit. */
const MERGE_WINDOW_MS = 3000;

type Events = { change: []; applied: [EditEvent]; proposed: [EditEvent]; cleared: [] };

/** Normalizes edits from every adapter into EditEvents. Pure: no vscode imports. */
export class EditTracker extends EventEmitter<Events> {
  /** Newest first. */
  readonly edits: EditEvent[] = [];
  /** Last known content per file: the `before` for the next edit. */
  private readonly known = new Map<string, string>();
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  /** Records a baseline without creating an edit (indexing, opening a document). */
  seed(file: string, text: string): void {
    if (!this.known.has(file)) this.known.set(file, text);
  }

  knownText(file: string): string | undefined {
    return this.known.get(file);
  }

  get(id: string): EditEvent | undefined {
    return this.edits.find((e) => e.id === id);
  }

  clear(): void {
    this.edits.length = 0;
    this.emit('cleared');
    this.emit('change');
  }

  record(raw: RawEdit): EditEvent | undefined {
    const ts = this.now();
    const after = raw.kind === 'delete' ? '' : raw.after;
    let before = raw.before ?? this.known.get(raw.file) ?? (raw.kind === 'create' ? '' : undefined);

    if (raw.status === 'applied') {
      const recent = (pred: (e: EditEvent) => boolean) =>
        this.edits.findIndex((e) => e.file === raw.file && ts - e.ts <= MERGE_WINDOW_MS && pred(e));

      if (raw.source === 'manual') {
        // The agent already reported this exact change.
        const i = recent((e) => e.source !== 'manual' && e.status === 'applied' && e.after === after);
        if (i >= 0) return undefined;
      } else {
        // The watcher beat the hook: relabel that entry as the agent's.
        const i = recent((e) => e.source === 'manual' && e.status === 'applied');
        if (i >= 0) before = raw.before ?? this.edits.splice(i, 1)[0]!.before;
        // Promote the matching proposal: it is replaced by this applied event.
        const p = this.edits.findIndex(
          (e) =>
            e.status === 'proposed' &&
            e.file === raw.file &&
            (!raw.toolUseId || e.toolUseId === raw.toolUseId),
        );
        if (p >= 0) {
          const proposal = this.edits.splice(p, 1)[0]!;
          before = raw.before ?? before ?? proposal.before;
        }
      }
      if (after !== undefined && before === after) return undefined; // no-op (e.g. watcher after save)
    }

    const diff = before !== undefined && after !== undefined ? lineDiff(before, after) : undefined;
    const ev: EditEvent = {
      ...raw,
      before,
      after,
      id: `e${++this.seq}`,
      ts,
      added: diff?.added,
      removed: diff?.removed,
      changedRanges: diff?.ranges ?? [],
    };
    this.edits.unshift(ev);
    if (this.edits.length > MAX_EDITS) this.edits.length = MAX_EDITS;

    if (raw.status === 'applied') {
      if (raw.kind === 'delete') this.known.delete(raw.file);
      else if (after !== undefined) this.known.set(raw.file, after);
      this.emit('applied', ev);
    } else {
      this.emit('proposed', ev);
    }
    this.emit('change');
    return ev;
  }

  /** Drops proposals that never landed (rejected / failed tool call). */
  discardProposed(toolUseId?: string): boolean {
    const before = this.edits.length;
    for (let i = this.edits.length - 1; i >= 0; i--) {
      const e = this.edits[i]!;
      if (e.status === 'proposed' && (!toolUseId || e.toolUseId === toolUseId)) this.edits.splice(i, 1);
    }
    const changed = this.edits.length !== before;
    if (changed) this.emit('change');
    return changed;
  }
}
