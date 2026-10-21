import type { RawEdit } from './EditEvent';

export interface EditSink {
  emit(e: RawEdit): void;
  /** Drop pending proposals (all, or the one for `toolUseId`): rejected or failed tool calls. */
  discard(toolUseId?: string): void;
}

/** Source of edit events (an agent integration or the manual fallback). */
export interface AgentAdapter {
  id: string;
  start(sink: EditSink): { dispose(): void };
}
