import { HOOK_EVENTS, HOOK_MATCHER } from '../capture/ClaudeCodeAdapter';

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

const isOurs = (g: HookGroup) => g.hooks?.some((h) => h.command?.includes(MARKER)) ?? false;

/**
 * Returns settings with FlowLens hook groups (re)installed. Existing non-FlowLens hooks are kept untouched;
 * earlier FlowLens groups are replaced, so re-running is idempotent.
 */
export function mergeHooks(settings: Json, command: string): Json {
  const hooks = { ...((settings.hooks as Json | undefined) ?? {}) };
  for (const event of HOOK_EVENTS) {
    const groups = ((hooks[event] as HookGroup[] | undefined) ?? []).filter((g) => !isOurs(g));
    const group: HookGroup = {
      hooks: [{ type: 'command', command, timeout: 5 } as { type: string; command: string }],
    };
    if (event !== 'Stop') group.matcher = HOOK_MATCHER;
    hooks[event] = [...groups, group];
  }
  return { ...settings, hooks };
}

/** Removes only FlowLens hook groups (and empty event arrays left behind). */
export function removeHooks(settings: Json): Json {
  const hooks = { ...((settings.hooks as Json | undefined) ?? {}) };
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    const kept = (groups as HookGroup[]).filter((g) => !isOurs(g));
    if (kept.length) hooks[event] = kept;
    else delete hooks[event];
  }
  const out: Json = { ...settings, hooks };
  if (Object.keys(hooks).length === 0) delete out.hooks;
  return out;
}

export const FORWARDER_FILE = `${MARKER}.js`;
