import { describe, expect, it } from 'vitest';
import { isWebviewMessage } from '../../src/shared/messages';

describe('isWebviewMessage', () => {
  it('accepts known messages', () => {
    expect(isWebviewMessage({ type: 'ready' })).toBe(true);
  });
  it('rejects unknown or malformed input', () => {
    for (const m of [null, undefined, 'ready', 42, {}, { type: 'nope' }, { type: 1 }]) {
      expect(isWebviewMessage(m)).toBe(false);
    }
  });
});
