import type { Node } from '@vscode/tree-sitter-wasm';
import { hashText } from '../hash';
import { edgeId, type FileFacts, type GraphNode, type NodeKind, type RefFact } from '../types';
import { range } from './Extractor';

/** Shared helpers for framework extractors (WordPress, JS routes, Python routes). */

export const CLOSURE_TYPES = new Set([
  'anonymous_function',
  'arrow_function',
  'function_expression',
  'function',
  'lambda',
]);

export function addNode(facts: FileFacts, n: GraphNode): string {
  if (!facts.nodes.some((x) => x.id === n.id)) facts.nodes.push(n);
  return n.id;
}

/** Closure callback -> its own function node; calls inside it are attributed to it (via meta.anchor). */
export function closureNode(facts: FileFacts, fn: Node, label: string): string {
  const qname = `closure@L${fn.startPosition.row + 1}`;
  return addNode(facts, {
    id: `${facts.file}::function::${qname}`,
    kind: 'function',
    label,
    file: facts.file,
    range: range(fn),
    hash: hashText(fn.text),
    meta: { name: qname, qname, anchor: fn.startIndex, anonymous: true },
  });
}

/** Framework entry node (hook/route/shortcode) -> callback edge or name ref. */
export function link(
  facts: FileFacts,
  from: string,
  cb: { id?: string; ref?: Omit<RefFact, 'from' | 'kind'> },
): void {
  if (cb.id)
    facts.edges.push({
      id: edgeId(from, cb.id, 'registers'),
      from,
      to: cb.id,
      kind: 'registers',
      confidence: 'high',
    });
  else if (cb.ref) facts.refs.push({ from, kind: 'registers', ...cb.ref });
}

export function entryNode(
  facts: FileFacts,
  kind: NodeKind,
  id: string,
  label: string,
  at: Node,
  meta?: Record<string, unknown>,
): string {
  return addNode(facts, { id, kind, label, file: facts.file, range: range(at), meta });
}

/** Registration made inside a closure we already turned into a node: closure -> entry edge. */
export function linkFromEnclosingClosure(facts: FileFacts, at: Node, entryId: string): void {
  for (let p = at.parent; p; p = p.parent) {
    if (!CLOSURE_TYPES.has(p.type)) continue;
    const id = `${facts.file}::function::closure@L${p.startPosition.row + 1}`;
    if (facts.nodes.some((n) => n.id === id)) link(facts, id, { id: entryId });
    return;
  }
}
