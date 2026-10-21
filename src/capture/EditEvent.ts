import type { LineRange } from '../util/lineDiff';

export type EditSource = 'claude-code' | 'manual' | 'other-agent';

/** What an adapter reports. EditTracker fills in the diff and the missing `before`. */
export interface RawEdit {
  source: EditSource;
  file: string; // workspace-relative, forward slashes
  kind: 'create' | 'modify' | 'delete';
  status: 'proposed' | 'applied';
  before?: string;
  after?: string;
  sessionId?: string;
  toolUseId?: string;
  tool?: string;
  /** Proposed text could not be computed exactly (e.g. old_string matched 0 or >1 times). */
  uncertain?: boolean;
}

export interface EditEvent extends RawEdit {
  id: string;
  ts: number;
  /** undefined = unknown (no baseline for the file yet). */
  added?: number;
  removed?: number;
  changedRanges: LineRange[];
  /** Graph symbols touched, filled in once the graph is rebuilt. */
  symbols?: string[];
}
