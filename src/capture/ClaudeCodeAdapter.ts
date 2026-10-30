// Everything Claude Code-specific lives here. Verified against https://code.claude.com/docs/en/hooks (2026-10):
// - stdin payload: session_id, cwd, hook_event_name, tool_name, tool_input, tool_use_id (+ tool_response on Post).
// - Edit: {file_path (absolute), old_string, new_string, replace_all?}; Write: {file_path, content}.
// - MultiEdit ({file_path, edits[]}) is no longer documented; handled if it ever arrives.
// - PostToolUseFailure / PermissionDenied: the proposed edit never landed. Stop: end of a response.
// - PreToolUse may print {hookSpecificOutput: {hookEventName, additionalContext}} on stdout (exit 0);
//   Claude reads it as a system reminder next to the tool result. We use it for the user's notes.
// - MCP tools are named `mcp__<server>__<tool>` (plugins: `mcp__plugin_<plugin>_<server>__<tool>`) and their
//   payloads carry `mcp_server: {name, source}`. PostToolUse/PostToolUseFailure carry `duration_ms`;
//   PostToolUseFailure carries `error` and `is_interrupt`. WebFetch input: {url, prompt}; WebSearch: {query}.
import { clip, type ActivityInput, type ActivityStatus } from './ActivityLog';
import type { AgentAdapter, EditSink } from './AgentAdapter';
import type { RawEdit } from './EditEvent';
import {
  applyStringEdit,
  applyStringEdits,
  type AppliedText,
  type StringEdit,
} from '../preview/applyToolEdit';

export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit'] as const;
export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionDenied',
  'Stop',
] as const;

const EDITS = 'Edit|Write|MultiEdit';
/** Calls outside the code: MCP tools and the web. `Bash` only after the fact (filtered to network commands),
 *  so ordinary shell commands don't pay for a hook before they run. */
const OUTSIDE = 'WebFetch|WebSearch|mcp__.*';
export const HOOK_MATCHERS: Record<(typeof HOOK_EVENTS)[number], string | undefined> = {
  PreToolUse: `${EDITS}|${OUTSIDE}`,
  PostToolUse: `${EDITS}|${OUTSIDE}|Bash`,
  PostToolUseFailure: `${EDITS}|${OUTSIDE}|Bash`,
  PermissionDenied: `${EDITS}|${OUTSIDE}`,
  Stop: undefined,
};
/** Present in installed settings once the MCP/web matchers are in (older installs lack it). */
export const OUTSIDE_MARKER = 'mcp__.*';

/** Shell commands that reach the network. ponytail: name-based; a command hiding its network use isn't seen. */
const NET_COMMAND =
  /(?:^|[\s;&|(`])(curl|wget|xh|https?|Invoke-WebRequest|Invoke-RestMethod|iwr|irm|ssh|scp|rsync|ftp|git\s+(?:clone|fetch|pull|push|ls-remote)|npm\s+(?:i|install|add|ci|publish)|pnpm\s+(?:i|install|add)|yarn\s+(?:add|install)|bun\s+(?:add|install)|pip3?\s+install|uv\s+(?:add|pip\s+install)|composer\s+(?:require|install|update)|docker\s+(?:pull|push)|gh\s+[a-z]+)\b/;
const host = (url: string) => {
  try {
    return new URL(url).host || url;
  } catch {
    return url;
  }
};

/** An MCP / web / network-shell call as an activity (kind, where it went, what was called), else undefined. */
export function classifyActivity(
  tool: string,
  input: Obj,
  p: Obj,
): Pick<ActivityInput, 'kind' | 'target' | 'action' | 'input'> | undefined {
  const mcp = /^mcp__(.+?)__(.+)$/.exec(tool);
  if (mcp)
    return {
      kind: 'mcp',
      target: str(obj(p.mcp_server)?.name) ?? mcp[1]!,
      action: mcp[2]!,
      input: clip(JSON.stringify(input)),
    };
  if (tool === 'WebFetch') {
    const url = str(input.url) ?? '';
    return { kind: 'web', target: host(url), action: 'fetch', input: clip(url) };
  }
  if (tool === 'WebSearch')
    return { kind: 'web', target: 'web search', action: 'search', input: clip(str(input.query) ?? '') };
  if (tool === 'Bash') {
    const cmd = str(input.command) ?? '';
    const net = NET_COMMAND.exec(cmd);
    if (!net) return undefined;
    const url = /https?:\/\/[^\s'"`)]+/.exec(cmd)?.[0];
    return {
      kind: 'net',
      target: url ? host(url) : net[1]!.split(/\s+/)[0]!,
      action: clip(cmd, 120),
      input: clip(cmd),
    };
  }
  return undefined;
}

const STATUS: Record<string, ActivityStatus | undefined> = {
  PreToolUse: 'running',
  PostToolUse: 'ok',
  PostToolUseFailure: 'error',
  PermissionDenied: 'denied',
};

type Obj = Record<string, unknown>;
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const obj = (v: unknown): Obj | undefined => (typeof v === 'object' && v !== null ? (v as Obj) : undefined);

function asStringEdit(v: unknown): StringEdit | undefined {
  const o = obj(v);
  const from = str(o?.old_string);
  const to = str(o?.new_string);
  return o && from !== undefined && to !== undefined
    ? { old_string: from, new_string: to, replace_all: o.replace_all === true }
    : undefined;
}

/** Proposed file text for an editing tool call, or undefined if the input is not understood. */
export function proposedText(tool: string, input: Obj, current: string): AppliedText | undefined {
  if (tool === 'Write') {
    const content = str(input.content);
    return content === undefined ? undefined : { text: content, uncertain: false };
  }
  if (tool === 'Edit') {
    const e = asStringEdit(input);
    return e && applyStringEdit(current, e);
  }
  if (tool === 'MultiEdit' && Array.isArray(input.edits)) {
    const edits = input.edits.map(asStringEdit);
    return edits.every(Boolean) ? applyStringEdits(current, edits as StringEdit[]) : undefined;
  }
  return undefined;
}

export interface FileAccess {
  /** Workspace-relative path for an absolute path, or null if not a tracked workspace file. */
  toRel(abs: string): string | null;
  read(abs: string): Promise<string | undefined>;
  /** Synchronous read for PreToolUse: must happen before we answer the hook, or the tool may write first. */
  readSync?(abs: string): string | undefined;
}

export interface AgentNote {
  label: string;
  kind: string;
  text: string;
}

/**
 * Hook stdout for a PreToolUse edit of a file the user left notes on, or undefined.
 * `notesFor` gets the workspace-relative file.
 */
export function hookReply(
  p: Obj,
  toRel: (abs: string) => string | null,
  notesFor: (file: string) => AgentNote[],
): Obj | undefined {
  if (
    p.hook_event_name !== 'PreToolUse' ||
    !(EDIT_TOOLS as readonly string[]).includes(str(p.tool_name) ?? '')
  )
    return undefined;
  const abs = str(obj(p.tool_input)?.file_path);
  const file = abs && toRel(abs);
  const notes = file ? notesFor(file) : [];
  if (!file || !notes.length) return undefined;
  const lines = notes.map((n) => `- ${n.label} (${n.kind}): ${n.text}`);
  return {
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      additionalContext: [
        `FlowLens: the user left instructions for code in ${file}. Check that this edit follows them; if it doesn't, fix it:`,
        ...lines,
      ].join('\n'),
    },
  };
}

/** Turns Claude Code hook payloads (via HookServer) into edit events. */
export class ClaudeCodeAdapter implements AgentAdapter {
  readonly id = 'claude-code';
  private sink: EditSink | undefined;
  /** File text captured before replying to PreToolUse (undefined value = file didn't exist). */
  private readonly before = new WeakMap<Obj, string | undefined>();

  constructor(private readonly files: FileAccess) {}

  start(sink: EditSink) {
    this.sink = sink;
    return { dispose: () => (this.sink = undefined) };
  }

  /**
   * Called synchronously before the hook gets its reply. Replying unblocks the tool, so reading the
   * current file later (in `handle`, behind the queue) could see the agent's write instead.
   */
  snapshot(p: Obj): void {
    if (p.hook_event_name !== 'PreToolUse' || !this.files.readSync) return;
    const abs = str(obj(p.tool_input)?.file_path);
    if (abs && (EDIT_TOOLS as readonly string[]).includes(str(p.tool_name) ?? '') && this.files.toRel(abs))
      this.before.set(p, this.files.readSync(abs));
  }

  async handle(p: Obj): Promise<void> {
    const sink = this.sink;
    if (!sink) return;
    const event = str(p.hook_event_name);
    const toolUseId = str(p.tool_use_id);
    const tool = str(p.tool_name) ?? '';
    const input = obj(p.tool_input);
    const status = event && STATUS[event];
    const outside = input && status && classifyActivity(tool, input, p);
    if (outside) {
      const failed = event === 'PostToolUseFailure';
      const response = p.tool_response;
      sink.activity?.({
        ...outside,
        source: 'claude-code',
        sessionId: str(p.session_id),
        toolUseId,
        status: failed && p.is_interrupt === true ? 'interrupted' : status,
        durationMs: typeof p.duration_ms === 'number' ? p.duration_ms : undefined,
        output: failed
          ? clip(str(p.error) ?? '')
          : response === undefined
            ? undefined
            : clip(typeof response === 'string' ? response : JSON.stringify(response)),
      });
      return;
    }
    // Stop ends one session's response: only its proposals (another session may be mid-permission-prompt).
    // Known gap: rejecting with Esc is an interrupt and sends no Stop; the proposal clears on the next one.
    if (event === 'Stop') return void sink.discard(undefined, str(p.session_id));
    if (event === 'PostToolUseFailure' || event === 'PermissionDenied') return void sink.discard(toolUseId);
    const abs = str(input?.file_path);
    if (!input || !abs || !(EDIT_TOOLS as readonly string[]).includes(tool)) return;
    const file = this.files.toRel(abs);
    if (!file) return;
    const base = { source: 'claude-code', file, tool, toolUseId, sessionId: str(p.session_id) } as const;

    if (event === 'PreToolUse') {
      const current = this.before.has(p) ? this.before.get(p) : await this.files.read(abs);
      const proposed = proposedText(tool, input, current ?? '');
      if (!proposed) return;
      const e: RawEdit = {
        ...base,
        kind: current === undefined ? 'create' : 'modify',
        status: 'proposed',
        before: current ?? '',
        after: proposed.text,
        uncertain: proposed.uncertain,
      };
      sink.emit(e);
    } else if (event === 'PostToolUse') {
      const after = await this.files.read(abs);
      if (after === undefined) return;
      const created = obj(p.tool_response)?.type === 'create';
      sink.emit({ ...base, kind: created ? 'create' : 'modify', status: 'applied', after });
    }
  }
}
