import type { Node } from '@vscode/tree-sitter-wasm';

const MAX = 200;

/** Comment/docstring text -> one short plain sentence (no markers, no @tags). */
export function cleanDoc(raw: string): string | undefined {
  const lines = raw
    .replace(/^\s*(\/\*\*?|"""|''')/, '')
    .replace(/(\*\/|"""|''')\s*$/, '')
    .split('\n')
    .map((l) => l.replace(/^\s*(\/\/+|#+|\*+(?!\/))\s?/, '').trim());
  const end = lines.findIndex((l) => l.startsWith('@') || /^(eslint|prettier|ts-|@ts-|phpcs)/.test(l));
  const text = (end === -1 ? lines : lines.slice(0, end)).join(' ').replace(/\s+/g, ' ').trim();
  if (!text || /^(-|=|\*|#){3,}$/.test(text)) return undefined;
  // First sentence; keep it short.
  const sentence = /^(.+?[.!?])(\s|$)/.exec(text)?.[1] ?? text;
  return sentence.length > MAX ? `${sentence.slice(0, MAX - 1)}…` : sentence;
}

const isComment = (n: Node | null): n is Node => !!n && n.type === 'comment';
const docstring = (n: Node | null | undefined): string | undefined => {
  const s = n?.type === 'expression_statement' ? n.namedChildren[0] : undefined;
  return s?.type === 'string' ? s.text : undefined;
};

/** Consecutive comments ending right above `n` (no blank line between). */
function commentAbove(n: Node): string | undefined {
  const parts: string[] = [];
  let line = n.startPosition.row;
  for (
    let c = n.previousNamedSibling;
    isComment(c) && line - c.endPosition.row <= 1;
    c = c.previousNamedSibling
  ) {
    if (c.previousNamedSibling?.endPosition.row === c.startPosition.row) break; // trailing comment of the line above
    parts.unshift(c.text);
    line = c.startPosition.row;
  }
  return parts.length ? parts.join('\n') : undefined;
}

/** Header comment (or Python module docstring) of a file, skipping `'use client'`-style directives. */
export function fileDoc(root: Node): string | undefined {
  for (const c of root.namedChildren) {
    if (!c) continue;
    if (c.type === 'php_tag' || (c.type === 'expression_statement' && /^['"]use /.test(c.text))) continue;
    if (isComment(c)) {
      const parts = [c.text];
      for (
        let n = c.nextNamedSibling, row = c.endPosition.row;
        isComment(n) && n.startPosition.row - row <= 1;
        n = n.nextNamedSibling
      ) {
        parts.push(n.text);
        row = n.endPosition.row;
      }
      const doc = cleanDoc(parts.join('\n'));
      if (doc) return doc;
      continue; // e.g. a license banner of dashes
    }
    const ds = docstring(c);
    return ds ? cleanDoc(ds) : undefined;
  }
  return undefined;
}

/** `'use client'` / `'use server'` at the top of a JS/TS file. */
export function directive(root: Node): string | undefined {
  for (const c of root.namedChildren) {
    if (!c || c.type === 'comment') continue;
    return c.type === 'expression_statement' ? /^['"](use (client|server))['"]/.exec(c.text)?.[1] : undefined;
  }
  return undefined;
}

/** Doc comment above a definition (climbing through export/const wrappers), or a Python docstring. */
export function symbolDoc(n: Node, body?: Node | null): string | undefined {
  const ds = body?.type === 'block' ? docstring(body.namedChildren[0]) : undefined;
  if (ds) return cleanDoc(ds);
  for (let cur: Node | null = n, i = 0; cur && i < 4; cur = cur.parent, i++) {
    const c = commentAbove(cur);
    if (c) return cleanDoc(c);
    if (!cur.parent || !/declarat|export_statement|decorated_definition/.test(cur.parent.type)) break;
  }
  return undefined;
}
