import { describe, expect, it } from 'vitest';
import { ActivityLog, type ActivityInput } from '../../src/capture/ActivityLog';
import { ClaudeCodeAdapter, classifyActivity } from '../../src/capture/ClaudeCodeAdapter';

describe('classifyActivity (Claude Code tool names)', () => {
  it('MCP tools, plugin servers, web fetch/search', () => {
    expect(classifyActivity('mcp__slack__send_message', { channel: '#x' }, {})).toMatchObject({
      kind: 'mcp',
      target: 'slack',
      action: 'send_message',
      input: '{"channel":"#x"}',
    });
    // mcp_server.name (v2.1.274+) wins over parsing the tool name
    expect(
      classifyActivity('mcp__plugin_kit_db__query', {}, { mcp_server: { name: 'db', source: 'plugin' } }),
    ).toMatchObject({ target: 'db', action: 'query' });
    expect(
      classifyActivity('WebFetch', { url: 'https://docs.example.com/a?b=1', prompt: 'x' }, {}),
    ).toMatchObject({
      kind: 'web',
      target: 'docs.example.com',
      action: 'fetch',
    });
    expect(classifyActivity('WebSearch', { query: 'react 19 hooks' }, {})).toMatchObject({
      kind: 'web',
      action: 'search',
      input: 'react 19 hooks',
    });
  });

  it('only network shell commands count', () => {
    const bash = (command: string) => classifyActivity('Bash', { command }, {});
    expect(bash('curl -s https://api.github.com/repos/x')).toMatchObject({
      kind: 'net',
      target: 'api.github.com',
    });
    expect(bash('cd app && npm install zod')).toMatchObject({ kind: 'net', target: 'npm' });
    expect(bash('git push origin main')).toMatchObject({ target: 'git' });
    expect(bash('ls -la && npm run build')).toBeUndefined();
    expect(bash('git status')).toBeUndefined();
    expect(classifyActivity('Read', { file_path: '/a' }, {})).toBeUndefined();
  });
});

describe('ClaudeCodeAdapter -> activity', () => {
  const run = async (payloads: Record<string, unknown>[]) => {
    const log = new ActivityLog();
    const a = new ClaudeCodeAdapter({ toRel: () => null, read: async () => undefined });
    a.start({
      emit: () => undefined,
      discard: (id, session) => (id ? undefined : log.interrupt(session)),
      activity: (x: ActivityInput) => void log.record(x),
    });
    for (const p of payloads) await a.handle(p);
    return log.items;
  };
  const call = { session_id: 's1', tool_name: 'mcp__github__search', tool_input: { q: 'flowlens' } };

  it('Pre then Post update one entry: running -> ok, with duration and result', async () => {
    const items = await run([
      { ...call, hook_event_name: 'PreToolUse', tool_use_id: 't1' },
      {
        ...call,
        hook_event_name: 'PostToolUse',
        tool_use_id: 't1',
        duration_ms: 812,
        tool_response: { total: 3 },
      },
    ]);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      status: 'ok',
      durationMs: 812,
      output: '{"total":3}',
      target: 'github',
    });
  });

  it('failures, interrupts and denials are recorded (not lost behind the edit path)', async () => {
    const items = await run([
      { ...call, hook_event_name: 'PreToolUse', tool_use_id: 'f' },
      { ...call, hook_event_name: 'PostToolUseFailure', tool_use_id: 'f', error: 'HTTP 502' },
      { ...call, hook_event_name: 'PostToolUseFailure', tool_use_id: 'i', is_interrupt: true, error: '' },
      { ...call, hook_event_name: 'PermissionDenied', tool_use_id: 'd' },
      { ...call, hook_event_name: 'PreToolUse', tool_use_id: 'r' },
      { hook_event_name: 'Stop', session_id: 's1' },
    ]);
    const by = Object.fromEntries(items.map((x) => [x.toolUseId, x]));
    expect(by.f).toMatchObject({ status: 'error', output: 'HTTP 502' });
    expect(by.i?.status).toBe('interrupted');
    expect(by.d?.status).toBe('denied');
    expect(by.r?.status).toBe('interrupted'); // still running when the response ended
  });
});

describe('ActivityLog', () => {
  it('caps at 200 entries, newest first', () => {
    const log = new ActivityLog();
    for (let i = 0; i < 205; i++)
      log.record({
        source: 'claude-code',
        kind: 'web',
        target: 'h',
        action: 'fetch',
        input: `${i}`,
        status: 'ok',
      });
    expect(log.items).toHaveLength(200);
    expect(log.items[0]!.input).toBe('204');
  });
});

describe('Cursor (afterMCPExecution only)', async () => {
  const { cursorActivity, isCursorPayload, CURSOR_EVENTS } = await import('../../src/capture/CursorAdapter');
  const { mergeCursorHooks, removeCursorHooks, forwarderCommand } =
    await import('../../src/commands/hooksConfig');
  const base = {
    hook_event_name: 'afterMCPExecution',
    cursor_version: '2.0.0',
    conversation_id: 'c1',
    tool_name: 'MCP:search_repositories',
    tool_input: '{"query":"flowlens"}',
    mcp_server_name: 'github',
    duration: 420,
  };

  it('maps the payload (JSON-string input/result, MCP: prefix, isError)', () => {
    expect(isCursorPayload(base)).toBe(true);
    expect(isCursorPayload({ hook_event_name: 'PreToolUse' })).toBe(false);
    expect(cursorActivity({ ...base, result_json: '{"content":[]}' })).toMatchObject({
      source: 'cursor',
      kind: 'mcp',
      target: 'github',
      action: 'search_repositories',
      input: '{"query":"flowlens"}',
      status: 'ok',
      durationMs: 420,
      sessionId: 'c1',
    });
    expect(cursorActivity({ ...base, result_json: '{"isError":true}' })?.status).toBe('error');
    expect(cursorActivity({ ...base, hook_event_name: 'beforeMCPExecution' })).toBeUndefined();
  });

  it('never installs a blocking before* hook; keeps user entries; removes only ours', () => {
    expect(CURSOR_EVENTS.every((e) => e.startsWith('after'))).toBe(true);
    const cmd = forwarderCommand('/x/flowlens-hook-forwarder.js');
    const user = { command: './hooks/audit.sh' };
    const settings = { version: 1, hooks: { afterMCPExecution: [user], beforeShellExecution: [user] } };
    const once = mergeCursorHooks(settings, cmd);
    expect(mergeCursorHooks(once, cmd)).toEqual(once);
    expect((once.hooks as Record<string, unknown[]>).afterMCPExecution).toEqual([user, { command: cmd }]);
    expect(Object.keys(once.hooks as object).filter((k) => k.startsWith('before'))).toEqual([
      'beforeShellExecution',
    ]);
    expect(removeCursorHooks(once)).toEqual(settings);
    expect(mergeCursorHooks({}, cmd)).toEqual({
      version: 1,
      hooks: { afterMCPExecution: [{ command: cmd }] },
    });
  });
});
