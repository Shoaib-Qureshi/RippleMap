import { describe, expect, it } from 'vitest';
import { cleanKey, summarize } from '../../src/ai/summarize';

const cfg = { baseUrl: 'https://openrouter.ai/api/v1/', model: 'openrouter/free', key: 'sk-test' };
const reply = (status: number, body: unknown) => async () =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('cleanKey', () => {
  it('accepts a key however it was pasted', () => {
    for (const raw of [
      'sk-or-v1-abc',
      ' sk-or-v1-abc\n',
      'OPENROUTER_API_KEY=sk-or-v1-abc',
      'export OPENROUTER_API_KEY = "sk-or-v1-abc"',
      "'sk-or-v1-abc'",
      'Bearer sk-or-v1-abc',
    ])
      expect(cleanKey(raw)).toBe('sk-or-v1-abc');
  });
});

describe('summarize', () => {
  it('posts an OpenAI-compatible chat request and returns one clean line', async () => {
    let url = '';
    let init: RequestInit | undefined;
    const fake = (async (u: string, i: RequestInit) => {
      url = u;
      init = i;
      return reply(200, { choices: [{ message: { content: '  Lists users.\n Admin only. ' } }] })();
    }) as unknown as typeof fetch;
    const out = await summarize(cfg, { file: 'app/page.tsx', code: 'x'.repeat(30_000) }, fake);
    expect(out).toBe('Lists users. Admin only.');
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect((init!.headers as Record<string, string>).authorization).toBe('Bearer sk-test');
    const body = JSON.parse(init!.body as string);
    expect(body.model).toBe('openrouter/free');
    expect(body.messages[1].content).toContain('Explain the file app/page.tsx.');
    expect(body.messages[1].content).toContain('… (truncated)');
  });

  it('turns provider errors into actionable messages', async () => {
    const run = (status: number, body: unknown) =>
      summarize(cfg, { file: 'a.ts', code: '' }, reply(status, body) as unknown as typeof fetch);
    await expect(run(401, { error: { message: 'No auth' } })).rejects.toThrow(/Set AI API Key/);
    await expect(run(429, {})).rejects.toThrow(/Rate limited/);
    await expect(run(200, { choices: [{ message: { content: '' } }] })).rejects.toThrow(/flowlens.ai.model/);
    const down = (async () => {
      throw new TypeError('fetch failed');
    }) as unknown as typeof fetch;
    await expect(summarize(cfg, { file: 'a.ts', code: '' }, down)).rejects.toThrow(/Could not reach/);
  });
});
