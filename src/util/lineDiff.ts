import { diffLines } from 'diff';

export interface LineRange {
  startLine: number; // 1-based, inclusive, in the *after* text
  endLine: number;
}

export interface LineDiffResult {
  added: number;
  removed: number;
  ranges: LineRange[];
}

export const normalizeEol = (s: string): string => s.replace(/\r\n?/g, '\n');

/** Line-level diff. CRLF/LF differences are ignored. Pure deletions map to the line where they happened. */
export function lineDiff(before: string, after: string): LineDiffResult {
  const parts = diffLines(normalizeEol(before), normalizeEol(after));
  let added = 0;
  let removed = 0;
  let line = 1;
  const ranges: LineRange[] = [];
  const push = (startLine: number, endLine: number) => {
    const last = ranges[ranges.length - 1];
    if (last && startLine <= last.endLine + 1) last.endLine = Math.max(last.endLine, endLine);
    else ranges.push({ startLine, endLine });
  };
  for (const p of parts) {
    const n = p.count ?? 0;
    if (p.added) {
      added += n;
      push(line, line + n - 1);
      line += n;
    } else if (p.removed) {
      removed += n;
      push(line, line);
    } else {
      line += n;
    }
  }
  return { added, removed, ranges };
}
