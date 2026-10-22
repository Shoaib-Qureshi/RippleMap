import type { RawEdit } from './EditEvent';

export interface EditSink {
  emit(e: RawEdit): void;
  /** Drop pending proposals (all, the one for `toolUseId`, or one session's): rejected or failed tool calls. */
  discard(toolUseId?: string, sessionId?: string): void;
}

/** Source of edit events (an agent integration or the manual fallback). */
export interface AgentAdapter {
  id: string;
  start(sink: EditSink): { dispose(): void };
}
