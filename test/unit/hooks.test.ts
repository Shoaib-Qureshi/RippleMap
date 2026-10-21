import * as http from 'node:http';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter, proposedText } from '../../src/capture/ClaudeCodeAdapter';
import { discoveryPath, normalizeDir } from '../../src/capture/discovery';
import type { RawEdit } from '../../src/capture/EditEvent';
import { HookServer, TOKEN_HEADER } from '../../src/capture/HookServer';
import { forwarderCommand, mergeHooks, removeHooks } from '../../src/commands/hooksConfig';
import { applyStringEdit } from '../../src/preview/applyToolEdit';

const forwarder = createRequire(import.meta.url)('../../hook/hook-forwarder.js') as {
  normalizeDir(p: string): string;
  discoveryPath(p: string): string;
};

describe('discovery', () => {
  it('forwarder and extension agree on the discovery path', () => {
    for (const d of [process.cwd(), '/tmp/x/', 'C:\\Users\\Me\\proj']) {
      expect(forwarder.normalizeDir(d)).toBe(normalizeDir(d));
      expect(forwarder.discoveryPath(d)).toBe(discoveryPath(d));
    }
  });
});

describe('applyStringEdit', () => {
  it('replaces a unique match', () => {
    expect(applyStringEdit('a b c', { old_string: 'b', new_string: 'X' })).toEqual({
      text: 'a X c',
      uncertain: false,
    });
  });
  it('flags 0 or multiple matches as uncertain', () => {
    expect(applyStringEdit('a', { old_string: 'z', new_string: 'X' }).uncertain).toBe(true);
    expect(applyStringEdit('b b', { old_string: 'b', new_string: 'X' })).toEqual({
      text: 'X b',
      uncertain: true,
    });
    expect(applyStringEdit('b b', { old_string: 'b', new_string: 'X', replace_all: true })).toEqual({
      text: 'X X',
      uncertain: false,
    });
  });
  it('matches LF old_string against CRLF text', () => {
    expect(applyStringEdit('a\r\nb\r\n', { old_string: 'a\nb', new_string: 'a\nc' })).toEqual({
      text: 'a\r\nc\r\n',
      uncertain: false,
    });
  });
});

describe('proposedText', () => {
  it('handles Write, Edit and MultiEdit', () => {
    expect(proposedText('Write', { content: 'x' }, 'old')?.text).toBe('x');
    expect(proposedText('Edit', { old_string: 'o', new_string: '0' }, 'foo')?.text).toBe('f0o');
    expect(
      proposedText(
        'MultiEdit',
        {
          edits: [
            { old_string: 'a', new_string: 'b' },
            { old_string: 'b', new_string: 'c' },
          ],
        },
        'a',
      )?.text,
    ).toBe('c');
    expect(proposedText('Edit', { new_string: 'x' }, 'foo')).toBeUndefined();
  });
});

describe('ClaudeCodeAdapter', () => {
  it('maps Pre/Post/Failure payloads to proposed/applied/discard', async () => {
    const disk: Record<string, string> = { '/w/a.ts': 'one\n' };
    const out: (RawEdit | string)[] = [];
    const a = new ClaudeCodeAdapter({
      toRel: (p) => (p.startsWith('/w/') ? p.slice(3) : null),
      read: async (p) => disk[p],
    });
    a.start({ emit: (e) => out.push(e), discard: (id) => out.push(`discard:${id}`) });
    const base = {
      session_id: 's1',
      tool_name: 'Edit',
      tool_use_id: 't1',
      tool_input: { file_path: '/w/a.ts', old_string: 'one', new_string: 'two' },
    };
    await a.handle({ ...base, hook_event_name: 'PreToolUse' });
    disk['/w/a.ts'] = 'two\n';
    await a.handle({ ...base, hook_event_name: 'PostToolUse', tool_response: {} });
    await a.handle({ ...base, hook_event_name: 'PostToolUseFailure' });
    await a.handle({
      ...base,
      hook_event_name: 'PreToolUse',
      tool_input: { file_path: '/elsewhere/x.ts', content: '' },
    });
    expect(out).toEqual([
      expect.objectContaining({
        status: 'proposed',
        file: 'a.ts',
        before: 'one\n',
        after: 'two\n',
        toolUseId: 't1',
        sessionId: 's1',
      }),
      expect.objectContaining({ status: 'applied', file: 'a.ts', after: 'two\n' }),
      'discard:t1',
    ]);
  });
});

describe('hooks config merge', () => {
  const cmd = forwarderCommand('C:\\Users\\me\\flowlens-hook-forwarder.js');
  it('uses forward slashes and quotes', () => {
    expect(cmd).toBe('node "C:/Users/me/flowlens-hook-forwarder.js"');
  });
  it('keeps user hooks, is idempotent, and removes cleanly', () => {
    const user = { matcher: 'Bash', hooks: [{ type: 'command', command: 'echo hi' }] };
    const settings = { permissions: { allow: ['x'] }, hooks: { PreToolUse: [user] } };
    const once = mergeHooks(settings, cmd);
    const twice = mergeHooks(once, cmd);
    expect(twice).toEqual(once);
    const pre = (once.hooks as Record<string, unknown[]>).PreToolUse!;
    expect(pre).toHaveLength(2);
    expect(pre[0]).toEqual(user);
    expect(pre[1]).toMatchObject({
      matcher: 'Edit|Write|MultiEdit',
      hooks: [{ type: 'command', command: cmd, timeout: 5 }],
    });
    expect((once.hooks as Record<string, unknown>).Stop).toBeDefined();
    expect(removeHooks(once)).toEqual(settings);
    expect(removeHooks(mergeHooks({}, cmd))).toEqual({});
  });
});

describe('HookServer', () => {
  const post = (port: number, body: string, token?: string) =>
    new Promise<number>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1',
          port,
          path: '/hook',
          method: 'POST',
          headers: token ? { [TOKEN_HEADER]: token } : {},
        },
        (res) => (res.resume(), resolve(res.statusCode ?? 0)),
      );
      req.on('error', reject);
      req.end(body);
    });

  it('rejects missing/bad tokens and malformed bodies, accepts valid payloads', async () => {
    const got: unknown[] = [];
    const s = new HookServer((p) => got.push(p));
    await s.start([]);
    try {
      expect(await post(s.port, '{"hook_event_name":"Stop"}')).toBe(401);
      expect(await post(s.port, '{"hook_event_name":"Stop"}', 'x'.repeat(64))).toBe(401);
      expect(await post(s.port, 'nope', s.token)).toBe(400);
      expect(await post(s.port, '{"a":1}', s.token)).toBe(400);
      expect(await post(s.port, '{"hook_event_name":"Stop"}', s.token)).toBe(204);
      expect(got).toEqual([{ hook_event_name: 'Stop' }]);
    } finally {
      s.dispose();
    }
  });
});
