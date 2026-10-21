import type { Node } from '@vscode/tree-sitter-wasm';
import { stringValue, walk, type Extractor } from './Extractor';
import { CLOSURE_TYPES, closureNode, entryNode, link, linkFromEnclosingClosure } from './framework';
import type { FileFacts } from '../types';

const REGISTER = new Set(['add_action', 'add_filter']);
const FIRE = new Set(['do_action', 'do_action_ref_array', 'apply_filters', 'apply_filters_ref_array']);

const args = (call: Node) =>
  (call.childForFieldName('arguments')?.namedChildren ?? [])
    .filter((a): a is Node => a?.type === 'argument')
    .map((a) => a.namedChildren[a.namedChildren.length - 1]!);

/** PHP callable -> node id (closure) or name ref. */
function callback(facts: FileFacts, v: Node | undefined, label: string): Parameters<typeof link>[2] {
  if (!v) return {};
  if (CLOSURE_TYPES.has(v.type)) return { id: closureNode(facts, v, label) };
  const s = stringValue(v);
  if (s !== undefined) {
    const m = s.split('::');
    return m.length === 2
      ? { ref: { name: m[1]!, targetKinds: ['method'] } }
      : { ref: { name: s, targetKinds: ['function'] } };
  }
  if (v.type === 'array_creation_expression') {
    const [obj, meth] = v.namedChildren.map((e) => e?.namedChildren[e.namedChildren.length - 1]);
    const name = stringValue(meth);
    if (name)
      return { ref: { name, targetKinds: ['method'], receiver: obj?.text === '$this' ? 'self' : 'other' } };
  }
  if (/name/.test(v.type)) return { ref: { name: v.text, targetKinds: ['function'] } }; // first-class callable-ish
  return {};
}

/** Value of `'key' => value` in a PHP array literal. */
function arrayValue(arr: Node | undefined, key: string): Node | undefined {
  for (const el of arr?.namedChildren ?? []) {
    if (el?.type !== 'array_element_initializer' || el.namedChildren.length < 2) continue;
    if (stringValue(el.namedChildren[0]) === key) return el.namedChildren[1] ?? undefined;
  }
}

/**
 * WordPress flow layer: add_action/add_filter -> hook node -> callback; do_action/apply_filters create the
 * hook node too (the calls extractor links the caller to it); shortcodes; REST routes. WooCommerce hooks flagged.
 */
export const wordpressExtractor: Extractor = {
  id: 'wordpress',
  languages: ['php'],
  extract({ root, facts }) {
    walk(root, (n) => {
      if (n.type !== 'function_call_expression') return;
      const fn = n.childForFieldName('function')?.text ?? '';
      if (!REGISTER.has(fn) && !FIRE.has(fn) && fn !== 'add_shortcode' && fn !== 'register_rest_route')
        return;
      const a = args(n);
      if (REGISTER.has(fn) || FIRE.has(fn)) {
        const hook = stringValue(a[0]);
        if (!hook) return;
        const type = /filter/.test(fn) ? 'filter' : 'action';
        const id = entryNode(facts, 'hook', `wp::hook::${hook}`, hook, n, {
          type,
          woocommerce: hook.startsWith('woocommerce_'),
        });
        if (REGISTER.has(fn)) link(facts, id, callback(facts, a[1], `${hook} callback`));
      } else if (fn === 'add_shortcode') {
        const tag = stringValue(a[0]);
        if (!tag) return;
        const id = entryNode(facts, 'shortcode', `wp::shortcode::${tag}`, `[${tag}]`, n);
        link(facts, id, callback(facts, a[1], `[${tag}] callback`));
      } else {
        const ns = stringValue(a[0]);
        const route = stringValue(a[1]);
        if (!ns || route === undefined) return;
        const opts = a[2];
        const method = (stringValue(arrayValue(opts, 'methods')) ?? 'GET').toUpperCase();
        const path = `/${ns.replace(/^\/|\/$/g, '')}/${route.replace(/^\//, '')}`;
        const id = entryNode(facts, 'route', `wp::route::${method} ${path}`, `${method} ${path}`, n, {
          method,
          path,
        });
        linkFromEnclosingClosure(facts, n, id);
        link(facts, id, callback(facts, arrayValue(opts, 'callback'), `${method} ${path} handler`));
      }
    });
  },
};
