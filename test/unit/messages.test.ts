import { describe, expect, it } from 'vitest';
import { isWebviewMessage } from '../../src/shared/messages';

describe('isWebviewMessage', () => {
  it('accepts known messages', () => {
    expect(isWebviewMessage({ type: 'ready' })).toBe(true);
    expect(isWebviewMessage({ type: 'scrub', index: 2 })).toBe(true);
    expect(isWebviewMessage({ type: 'scrub', index: null })).toBe(true);
    expect(isWebviewMessage({ type: 'openFile', file: 'a.ts', line: 3 })).toBe(true);
  });
  it('rejects unknown or malformed input', () => {
    for (const m of [
      null,
      undefined,
      'ready',
      42,
      {},
      { type: 'nope' },
      { type: 1 },
      { type: 'scrub', index: -1 },
      { type: 'scrub', index: '1' },
      { type: 'openFile' },
    ]) {
      expect(isWebviewMessage(m)).toBe(false);
    }
  });
});
