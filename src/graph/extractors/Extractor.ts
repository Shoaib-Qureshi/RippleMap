import type { Node } from '@vscode/tree-sitter-wasm';
import type { FileFacts, Lang } from '../types';

export interface ExtractContext {
  file: string;
  lang: Lang;
  text: string;
  root: Node;
  facts: FileFacts;
}

/** Adds nodes/imports/refs for one parsed file. Extractors run in order; later ones may use earlier facts. */
export interface Extractor {
  id: string;
  languages: readonly Lang[];
  extract(ctx: ExtractContext): void;
}

/** Depth-first walk over all nodes. Return false from `visit` to skip a node's children. */
export function walk(root: Node, visit: (n: Node) => boolean | void): void {
  const c = root.walk();
  try {
    let down = visit(c.currentNode) !== false;
    for (;;) {
      if (down && c.gotoFirstChild()) {
        down = visit(c.currentNode) !== false;
        continue;
      }
      while (!c.gotoNextSibling()) if (!c.gotoParent()) return;
      down = visit(c.currentNode) !== false;
    }
  } finally {
    c.delete();
  }
}

/** Contents of a string literal node (any grammar), without quotes. */
export function stringValue(n: Node | null | undefined): string | undefined {
  if (!n) return undefined;
  if (/string/.test(n.type)) {
    const t = n.text;
    const q = t[0];
    if ((q === '"' || q === "'" || q === '`') && t.endsWith(q!)) return t.slice(1, -1);
    // Python string nodes: prefix + quotes (e.g. f"..."); take string_content children.
    const parts = n.namedChildren.filter(
      (c) => c?.type === 'string_content' || c?.type === 'string_fragment',
    );
    if (parts.length) return parts.map((c) => c!.text).join('');
    const m = /^[a-zA-Z]*(['"]{1,3})([\s\S]*)\1$/.exec(t);
    if (m) return m[2];
  }
  return undefined;
}

export const line = (n: Node) => n.startPosition.row + 1;
export const range = (n: Node) => ({ startLine: n.startPosition.row + 1, endLine: n.endPosition.row + 1 });
