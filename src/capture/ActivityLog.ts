import { EventEmitter } from 'node:events';

export type ActivityKind = 'mcp' | 'web' | 'net';
export type ActivityStatus = 'running' | 'ok' | 'error' | 'denied' | 'interrupted';

/** One call an agent made outside the code: an MCP tool, a web fetch/search, or a network shell command. */
export interface Activity {
  id: string;
  ts: number;
  source: 'claude-code' | 'cursor';
  sessionId?: string;
  toolUseId?: string;
  kind: ActivityKind;
  /** Where it went: MCP server name, web host ("web search" for searches), or host / command for shell. */
  target: string;
  /** What was called: the MCP tool, "fetch" / "search", or the shell command. */
  action: string;
  /** Short readable input: arguments, URL, query. */
  input: string;
  status: ActivityStatus;
  durationMs?: number;
  /** Short result or error text. */
  output?: string;
}

export type ActivityInput = Omit<Activity, 'id' | 'ts'>;

const MAX_ITEMS = 200;

/** Shortens payload text for display; full MCP inputs/results can be large and private. */
export const clip = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** In-memory log of agent activity outside the code (never persisted or sent anywhere). Newest first. */
export class ActivityLog extends EventEmitter<{ change: [] }> {
  readonly items: Activity[] = [];
  private seq = 0;

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  /** Adds a call, or updates the one with the same tool call id (running -> ok / error / denied). */
  record(a: ActivityInput): Activity {
    const prev = a.toolUseId ? this.items.find((x) => x.toolUseId === a.toolUseId) : undefined;
    if (prev) {
      Object.assign(prev, { ...a, input: a.input || prev.input });
    } else {
      this.items.unshift({ ...a, id: `a${++this.seq}`, ts: this.now() });
      if (this.items.length > MAX_ITEMS) this.items.length = MAX_ITEMS;
    }
    this.emit('change');
    return prev ?? this.items[0]!;
  }

  /** The agent's response ended (or was stopped): calls still "running" never finished. */
  interrupt(sessionId?: string): void {
    let any = false;
    for (const a of this.items)
      if (a.status === 'running' && (!sessionId || !a.sessionId || a.sessionId === sessionId)) {
        a.status = 'interrupted';
        any = true;
      }
    if (any) this.emit('change');
  }

  clear(): void {
    this.items.length = 0;
    this.emit('change');
  }
}
