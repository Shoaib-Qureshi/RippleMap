import { HOOK_EVENTS, HOOK_MATCHERS } from '../capture/ClaudeCodeAdapter';
import { CURSOR_EVENTS } from '../capture/CursorAdapter';

const MARKER = 'flowlens-hook-forwarder';

type Json = Record<string, unknown>;
interface HookGroup {
  matcher?: string;
  hooks?: { type?: string; command?: string }[];
}

/** Shell-form command valid in both Git Bash and PowerShell (forward slashes, double quotes). */
export function forwarderCommand(forwarderPath: string): string {
  return `node "${forwarderPath.replace(/\\/g, '/')}"`;
}

const isOursHook = (h: unknown) =>
  typeof h === 'object' && h !== null && String((h as { command?: unknown }).command ?? '').includes(MARKER);

/**
 * An event's groups minus FlowLens hooks: only our commands are dropped (a user hook sharing a group
 * stays), groups left empty go. Non-array / malformed values are returned untouched.
 */
function withoutOurs(groups: unknown): unknown {
  if (!Array.isArray(groups)) return groups;
  return groups.flatMap((g: unknown) => {
    const hooks = (g as HookGroup | null)?.hooks;
    if (!Array.isArray(hooks) || !hooks.some(isOursHook)) return [g];
    const kept = hooks.filter((h) => !isOursHook(h));
    return kept.length ? [{ ...(g as HookGroup), hooks: kept }] : [];
  });
}

/**
 * Returns settings with FlowLens hook groups (re)installed. Existing non-FlowLens hooks are kept untouched;
 * earlier FlowLens groups are replaced, so re-running is idempotent.
 */
export function mergeHooks(settings: Json, command: string): Json {
  const hooks = { ...((settings.hooks as Json | undefined) ?? {}) };
  for (const event of HOOK_EVENTS) {
    const existing = withoutOurs(hooks[event] ?? []);
    if (!Array.isArray(existing)) continue; // not a list: the user's own format, leave it alone
    const groups = existing;
    const group: HookGroup = {
      hooks: [{ type: 'command', command, timeout: 5 } as { type: string; command: string }],
    };
    const matcher = HOOK_MATCHERS[event];
    if (matcher) group.matcher = matcher;
    hooks[event] = [...groups, group];
  }
  return { ...settings, hooks };
}

/** Removes only FlowLens hook groups (and empty event arrays left behind). */
export function removeHooks(settings: Json): Json {
  const hooks = { ...((settings.hooks as Json | undefined) ?? {}) };
  for (const [event, groups] of Object.entries(hooks)) {
    const kept = withoutOurs(groups);
    if (!Array.isArray(kept) || kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  const out: Json = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete out.hooks;
  return out;
}

export const FORWARDER_FILE = `${MARKER}.js`;

/**
 * `.cursor/hooks.json` with FlowLens' Cursor hooks (re)installed: `{version: 1, hooks: {event: [{command}]}}`.
 * Other entries are kept; only FlowLens commands are replaced. Only `after*` events (see CursorAdapter).
 */
export function mergeCursorHooks(settings: Json, command: string): Json {
  const hooks = { ...((settings.hooks as Json | undefined) ?? {}) };
  for (const event of CURSOR_EVENTS) {
    const existing = hooks[event] ?? [];
    if (!Array.isArray(existing)) continue; // the user's own format: leave it alone
    hooks[event] = [...existing.filter((h) => !isOursHook(h)), { command }];
  }
  return { version: 1, ...settings, hooks };
}

/** Removes only FlowLens commands from `.cursor/hooks.json` (and event lists left empty). */
export function removeCursorHooks(settings: Json): Json {
  const hooks = { ...((settings.hooks as Json | undefined) ?? {}) };
  for (const [event, list] of Object.entries(hooks)) {
    if (!Array.isArray(list)) continue;
    const kept = list.filter((h) => !isOursHook(h));
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  return { ...settings, hooks };
}
