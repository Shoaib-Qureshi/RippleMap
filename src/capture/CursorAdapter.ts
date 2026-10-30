// Everything Cursor-specific lives here. From https://cursor.com/docs/agent/hooks (2026-10):
// - Project hooks: `.cursor/hooks.json` = {version: 1, hooks: {<event>: [{command}]}}, run from the project root.
// - `afterMCPExecution` stdin: tool_name, tool_input (JSON *string*), mcp_server_name, mcp_server_url (HTTP/SSE
//   servers only), result_json (string), duration (ms, excludes approval wait); common fields include
//   hook_event_name, conversation_id, cursor_version, workspace_roots.
// - `before*` hooks are permission hooks: exit 0 with empty or invalid stdout BLOCKS the action. RippleMap prints
//   nothing, so it must never register one. `after*` hooks have no permission semantics.
import { clip, type ActivityInput } from './ActivityLog';
import type { AgentAdapter, EditSink } from './AgentAdapter';

type Obj = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);

/** The only Cursor events RippleMap installs. Never add a `before*` event (see above). */
export const CURSOR_EVENTS = ['afterMCPExecution'] as const;

export const isCursorPayload = (p: Obj) =>
  typeof p.cursor_version === 'string' || (CURSOR_EVENTS as readonly unknown[]).includes(p.hook_event_name);

/** afterMCPExecution -> an MCP activity entry (Cursor reports finished calls only). */
export function cursorActivity(p: Obj): ActivityInput | undefined {
  if (p.hook_event_name !== 'afterMCPExecution') return undefined;
  const result = str(p.result_json);
  let failed = false;
  try {
    failed = result !== undefined && (JSON.parse(result) as { isError?: unknown })?.isError === true;
  } catch {
    /* not JSON: show as text */
  }
  return {
    source: 'cursor',
    kind: 'mcp',
    target: str(p.mcp_server_name) ?? 'mcp',
    action: (str(p.tool_name) ?? '').replace(/^MCP:/, ''),
    input: clip(str(p.tool_input) ?? ''),
    status: failed ? 'error' : 'ok',
    durationMs: typeof p.duration === 'number' ? p.duration : undefined,
    output: result === undefined ? undefined : clip(result),
    sessionId: str(p.conversation_id),
  };
}

export class CursorAdapter implements AgentAdapter {
  readonly id = 'cursor';
  private sink: EditSink | undefined;

  start(sink: EditSink) {
    this.sink = sink;
    return { dispose: () => (this.sink = undefined) };
  }

  handle(p: Obj): void {
    const a = cursorActivity(p);
    if (a) this.sink?.activity?.(a);
  }
}
