import { spawn } from 'node:child_process';
import * as fs from 'node:fs';
import * as http from 'node:http';
import * as os from 'node:os';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { ClaudeCodeAdapter, hookReply, proposedText } from '../../src/capture/ClaudeCodeAdapter';
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
  it('PreToolUse uses the text captured before replying, even if the tool already wrote', async () => {
    const disk: Record<string, string> = { '/w/a.ts': 'one\n' };
    const out: RawEdit[] = [];
    const a = new ClaudeCodeAdapter({
      toRel: (p) => (p.startsWith('/w/') ? p.slice(3) : null),
      read: async (p) => disk[p],
      readSync: (p) => disk[p],
    });
    a.start({ emit: (e) => out.push(e), discard: () => undefined });
    const pre = {
      hook_event_name: 'PreToolUse',
      tool_name: 'Edit',
      tool_input: { file_path: '/w/a.ts', old_string: 'one', new_string: 'two' },
    };
    a.snapshot(pre); // what the hook server does before answering
    disk['/w/a.ts'] = 'two\n'; // the tool wins the race
    await a.handle(pre);
    expect(out[0]).toMatchObject({ status: 'proposed', before: 'one\n', after: 'two\n', uncertain: false });
  });

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

describe('hooks config: user hooks are never lost', () => {
  const cmd = forwarderCommand('/x/flowlens-hook-forwarder.js');
  it('keeps a user hook that shares a group with ours, and leaves malformed values alone', () => {
    const settings = {
      hooks: {
        PreToolUse: [
          {
            matcher: 'Edit',
            hooks: [
              { type: 'command', command: cmd },
              { type: 'command', command: 'mine' },
            ],
          },
        ],
        Stop: 'not-a-list',
      },
    };
    const merged = mergeHooks(settings, cmd) as { hooks: Record<string, unknown> };
    expect(JSON.stringify(merged.hooks.PreToolUse)).toContain('"mine"');
    expect(merged.hooks.Stop).toBe('not-a-list');
    const removed = removeHooks(merged) as { hooks: Record<string, unknown> };
    expect(removed.hooks.PreToolUse).toEqual([
      { matcher: 'Edit', hooks: [{ type: 'command', command: 'mine' }] },
    ]);
    expect(removed.hooks.Stop).toBe('not-a-list');
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

describe('notes for the agent', () => {
  const pre = (file: string, tool = 'Edit') => ({
    hook_event_name: 'PreToolUse',
    tool_name: tool,
    tool_input: { file_path: file },
  });
  const toRel = (abs: string) => (abs.startsWith('/w/') ? abs.slice(3) : null);
  const notesFor = (f: string) =>
    f === 'a.ts' ? [{ label: 'save', kind: 'function', text: 'keep it sync' }] : [];

  it('replies only for PreToolUse edits of files with notes', () => {
    const r = hookReply(pre('/w/a.ts'), toRel, notesFor) as { hookSpecificOutput: Record<string, string> };
    expect(r.hookSpecificOutput.hookEventName).toBe('PreToolUse');
    expect(r.hookSpecificOutput.additionalContext).toContain('- save (function): keep it sync');
    expect(hookReply(pre('/w/b.ts'), toRel, notesFor)).toBeUndefined();
    expect(hookReply(pre('/x/a.ts'), toRel, notesFor)).toBeUndefined();
    expect(hookReply(pre('/w/a.ts', 'Bash'), toRel, notesFor)).toBeUndefined();
    expect(hookReply({ ...pre('/w/a.ts'), hook_event_name: 'PostToolUse' }, toRel, notesFor)).toBeUndefined();
  });

  it('the forwarder prints the reply and exits 0; prints nothing without one', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fl-notes-'));
    const s = new HookServer(
      () => undefined,
      (p) => ((p.tool_input as { file_path: string }).file_path === 'a' ? { ok: 1 } : undefined),
    );
    await s.start([dir]);
    const run = (file: string) =>
      new Promise<{ code: number | null; out: string }>((resolve) => {
        const c = spawn(process.execPath, ['hook/hook-forwarder.js'], {
          env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
        });
        let out = '';
        c.stdout.on('data', (d: Buffer) => (out += d.toString()));
        c.on('close', (code) => resolve({ code, out }));
        c.stdin.end(JSON.stringify({ hook_event_name: 'PreToolUse', tool_input: { file_path: file } }));
      });
    try {
      expect(await run('a')).toEqual({ code: 0, out: '{"ok":1}' });
      expect(await run('b')).toEqual({ code: 0, out: '' });
    } finally {
      s.dispose();
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
