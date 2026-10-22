// Everything Claude Code-specific lives here. Verified against https://code.claude.com/docs/en/hooks (2026-10):
// - stdin payload: session_id, cwd, hook_event_name, tool_name, tool_input, tool_use_id (+ tool_response on Post).
// - Edit: {file_path (absolute), old_string, new_string, replace_all?}; Write: {file_path, content}.
// - MultiEdit ({file_path, edits[]}) is no longer documented; handled if it ever arrives.
// - PostToolUseFailure / PermissionDenied: the proposed edit never landed. Stop: end of a response.
// - PreToolUse may print {hookSpecificOutput: {hookEventName, additionalContext}} on stdout (exit 0);
//   Claude reads it as a system reminder next to the tool result. We use it for the user's notes.
import type { AgentAdapter, EditSink } from './AgentAdapter';
import type { RawEdit } from './EditEvent';
import {
  applyStringEdit,
  applyStringEdits,
  type AppliedText,
  type StringEdit,
} from '../preview/applyToolEdit';

export const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit'] as const;
export const HOOK_MATCHER = 'Edit|Write|MultiEdit';
export const HOOK_EVENTS = [
  'PreToolUse',
  'PostToolUse',
  'PostToolUseFailure',
  'PermissionDenied',
  'Stop',
] as const;

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

  constructor(private readonly files: FileAccess) {}

  start(sink: EditSink) {
    this.sink = sink;
    return { dispose: () => (this.sink = undefined) };
  }

  async handle(p: Obj): Promise<void> {
    const sink = this.sink;
    if (!sink) return;
    const event = str(p.hook_event_name);
    const toolUseId = str(p.tool_use_id);
    if (event === 'Stop') return void sink.discard();
    if (event === 'PostToolUseFailure' || event === 'PermissionDenied') return void sink.discard(toolUseId);

    const tool = str(p.tool_name) ?? '';
    const input = obj(p.tool_input);
    const abs = str(input?.file_path);
    if (!input || !abs || !(EDIT_TOOLS as readonly string[]).includes(tool)) return;
    const file = this.files.toRel(abs);
    if (!file) return;
    const base = { source: 'claude-code', file, tool, toolUseId, sessionId: str(p.session_id) } as const;

    if (event === 'PreToolUse') {
      const current = await this.files.read(abs);
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
