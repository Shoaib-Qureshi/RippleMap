import type { RawEdit } from './EditEvent';

/** Source of edit events (an agent integration or the manual fallback). */
export interface AgentAdapter {
  id: string;
  start(emit: (e: RawEdit) => void): { dispose(): void };
}
