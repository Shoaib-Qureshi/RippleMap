import { describe, expect, it } from 'vitest';
import { lineDiff } from '../../src/util/lineDiff';

describe('lineDiff', () => {
  it('counts added/removed and reports ranges in after-text lines', () => {
    const r = lineDiff('a\nb\nc\n', 'a\nB\nc\nd\n');
    expect(r).toEqual({
      added: 2,
      removed: 1,
      ranges: [
        { startLine: 2, endLine: 2 },
        { startLine: 4, endLine: 4 },
      ],
    });
  });
  it('maps pure deletions to the line where they happened', () => {
    expect(lineDiff('a\nb\nc\n', 'a\nc\n')).toEqual({
      added: 0,
      removed: 1,
      ranges: [{ startLine: 2, endLine: 2 }],
    });
  });
  it('ignores CRLF vs LF', () => {
    expect(lineDiff('a\r\nb\r\n', 'a\nb\n')).toEqual({ added: 0, removed: 0, ranges: [] });
  });
  it('handles create from empty', () => {
    expect(lineDiff('', 'x\ny\n')).toEqual({ added: 2, removed: 0, ranges: [{ startLine: 1, endLine: 2 }] });
  });
});
