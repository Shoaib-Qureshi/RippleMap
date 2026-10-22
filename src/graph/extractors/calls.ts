import type { Node } from '@vscode/tree-sitter-wasm';
import { hashText } from '../hash';
import type { GraphNode, Lang, NodeKind, RefFact } from '../types';
import { range, type ExtractContext, type Extractor } from './Extractor';
import { symbolDoc } from '../docs';

const JSX = ['jsx_element', 'jsx_self_closing_element', 'jsx_fragment'];
const isCap = (s: string) => /^[A-Z]/.test(s);
const lastSegment = (s: string) => s.slice(Math.max(s.lastIndexOf('\\'), s.lastIndexOf('.')) + 1);

interface Scope {
  id: string;
  qname: string;
  cls?: string; // enclosing class name
}

const docMeta = (n: Node, body?: Node | null) => {
  const doc = symbolDoc(n, body);
  return doc ? { doc } : {};
};

type Def = { kind: NodeKind; name: string; body?: Node | null };

/** Language rules: what declares a symbol, and what references one. */
interface Rules {
  def(n: Node, inClass: boolean, lang: Lang): Def | undefined;
  /** Class bases (extends). */
  bases(n: Node): string[];
  ref(n: Node): Omit<RefFact, 'from'> | undefined;
  isClass(n: Node): boolean;
}

const js: Rules = {
  isClass: (n) =>
    ['class_declaration', 'class', 'abstract_class_declaration'].includes(n.type) &&
    !!n.childForFieldName('name'),
  def(n, inClass, lang) {
    const name = n.childForFieldName('name')?.text;
    switch (n.type) {
      case 'function_declaration':
      case 'generator_function_declaration':
        if (!name) return;
        return {
          kind: componentish(name, n, lang) ? 'component' : 'function',
          name,
          body: n.childForFieldName('body'),
        };
      case 'class_declaration':
      case 'abstract_class_declaration':
      case 'class':
        return name ? { kind: 'class', name, body: n.childForFieldName('body') } : undefined;
      case 'method_definition':
        return inClass && name ? { kind: 'method', name, body: n.childForFieldName('body') } : undefined;
      case 'variable_declarator': {
        const v = n.childForFieldName('value');
        const id = n.childForFieldName('name');
        if (
          !v ||
          id?.type !== 'identifier' ||
          !['arrow_function', 'function_expression', 'function'].includes(v.type)
        )
          return;
        return {
          kind: componentish(id.text, v, lang) ? 'component' : 'function',
          name: id.text,
          body: v.childForFieldName('body'),
        };
      }
    }
  },
  bases(n) {
    const h = n.namedChildren.find((c) => c?.type === 'class_heritage');
    const ext =
      h?.namedChildren.find((c) => c?.type === 'extends_clause')?.childForFieldName('value') ??
      h?.namedChildren[0];
    return ext && ['identifier', 'member_expression'].includes(ext.type) ? [lastSegment(ext.text)] : [];
  },
  ref(n) {
    if (n.type === 'call_expression') {
      const f = n.childForFieldName('function');
      if (f?.type === 'identifier' && f.text !== 'require') return { name: f.text, kind: 'calls' };
      if (f?.type === 'member_expression') {
        const p = f.childForFieldName('property')?.text;
        const o = f.childForFieldName('object');
        if (p) return { name: p, kind: 'calls', receiver: o?.type === 'this' ? 'self' : 'other' };
      }
    } else if (n.type === 'new_expression') {
      const c = n.childForFieldName('constructor');
      if (c && ['identifier', 'member_expression'].includes(c.type))
        return { name: lastSegment(c.text), kind: 'calls', targetKinds: ['class'] };
    } else if (n.type === 'jsx_opening_element' || n.type === 'jsx_self_closing_element') {
      const name = n.childForFieldName('name')?.text;
      if (name && isCap(lastSegment(name)))
        return { name: lastSegment(name), kind: 'renders', targetKinds: ['component', 'function', 'class'] };
    }
  },
};

function componentish(name: string, n: Node, lang: Lang) {
  return isCap(name) && (lang === 'tsx' || lang === 'javascript') && n.descendantsOfType(JSX).length > 0;
}

const php: Rules = {
  isClass: (n) => n.type === 'class_declaration',
  def(n, inClass) {
    const name = n.childForFieldName('name')?.text;
    if (!name) return;
    if (n.type === 'function_definition')
      return { kind: 'function', name, body: n.childForFieldName('body') };
    if (n.type === 'class_declaration') return { kind: 'class', name, body: n.childForFieldName('body') };
    if (n.type === 'method_declaration' && inClass)
      return { kind: 'method', name, body: n.childForFieldName('body') };
  },
  bases(n) {
    const b = n.namedChildren.find((c) => c?.type === 'base_clause');
    return b ? b.namedChildren.filter((c) => c && /name/.test(c.type)).map((c) => lastSegment(c!.text)) : [];
  },
  ref(n) {
    if (n.type === 'function_call_expression') {
      const f = n.childForFieldName('function');
      // WordPress: firing a hook is a call into it (the hook node comes from the wordpress extractor).
      if (f && /^(do_action|apply_filters)(_ref_array)?$/.test(f.text)) {
        const arg = n.childForFieldName('arguments')?.namedChildren[0]?.namedChildren[0];
        const hook = arg && /string/.test(arg.type) ? arg.text.slice(1, -1) : undefined;
        if (hook) return { name: hook, kind: 'calls', targetKinds: ['hook'] };
      }
      if (f && /name/.test(f.type)) return { name: lastSegment(f.text), kind: 'calls' };
    } else if (n.type === 'member_call_expression' || n.type === 'nullsafe_member_call_expression') {
      const name = n.childForFieldName('name')?.text;
      const o = n.childForFieldName('object')?.text;
      if (name) return { name, kind: 'calls', receiver: o === '$this' ? 'self' : 'other' };
    } else if (n.type === 'scoped_call_expression') {
      const name = n.childForFieldName('name')?.text;
      const scope = n.childForFieldName('scope')?.text ?? '';
      if (name)
        return {
          name,
          kind: 'calls',
          receiver: ['self', 'static', 'parent'].includes(scope) ? 'self' : 'other',
        };
    } else if (n.type === 'object_creation_expression') {
      const c = n.namedChildren.find((x) => x && /name/.test(x.type));
      if (c) return { name: lastSegment(c.text), kind: 'calls', targetKinds: ['class'] };
    }
  },
};

const py: Rules = {
  isClass: (n) => n.type === 'class_definition',
  def(n, inClass) {
    const name = n.childForFieldName('name')?.text;
    if (!name) return;
    if (n.type === 'function_definition')
      return { kind: inClass ? 'method' : 'function', name, body: n.childForFieldName('body') };
    if (n.type === 'class_definition') return { kind: 'class', name, body: n.childForFieldName('body') };
  },
  bases(n) {
    const args = n.childForFieldName('superclasses');
    return args
      ? args.namedChildren
          .filter((c) => c?.type === 'identifier' || c?.type === 'attribute')
          .map((c) => lastSegment(c!.text))
      : [];
  },
  ref(n) {
    if (n.type !== 'call') return;
    const f = n.childForFieldName('function');
    if (f?.type === 'identifier') return { name: f.text, kind: 'calls' };
    if (f?.type === 'attribute') {
      const name = f.childForFieldName('attribute')?.text;
      const o = f.childForFieldName('object')?.text;
      if (name) return { name, kind: 'calls', receiver: o === 'self' || o === 'cls' ? 'self' : 'other' };
    }
  },
};

const RULES: Record<Lang, Rules> = { javascript: js, typescript: js, tsx: js, php, python: py };

/**
 * Function-level graph: definitions (function/method/class/component) and name-based references
 * (calls, `new`, extends, JSX renders). Calls outside any definition come from the file node.
 * Closure nodes added earlier by framework extractors (meta.anchor = start index) become scopes too.
 */
export const callsExtractor: Extractor = {
  id: 'calls',
  languages: ['javascript', 'typescript', 'tsx', 'php', 'python'],
  extract(ctx: ExtractContext) {
    const { file, lang, root, facts } = ctx;
    const rules = RULES[lang];
    const anchors = new Map<number, GraphNode>();
    for (const n of facts.nodes) if (typeof n.meta?.anchor === 'number') anchors.set(n.meta.anchor, n);
    const seenIds = new Set(facts.nodes.map((n) => n.id));
    const seenRefs = new Set<string>();
    const fileScope: Scope = { id: facts.nodes[0]!.id, qname: '' };

    const addRef = (from: string, r: Omit<RefFact, 'from'>) => {
      const key = `${from}|${r.kind}|${r.name}|${r.receiver ?? ''}`;
      if (seenRefs.has(key)) return;
      seenRefs.add(key);
      facts.refs.push({ from, ...r });
    };

    const visit = (n: Node, scope: Scope, inClass: boolean): void => {
      const anchored = anchors.get(n.startIndex);
      if (anchored && anchored.file === file) {
        scope = { id: anchored.id, qname: String(anchored.meta?.qname ?? anchored.label), cls: scope.cls };
        inClass = false;
      }
      const def = rules.def(n, inClass, lang);
      let childScope = scope;
      let childInClass = inClass && !def; // class bodies only directly
      if (def) {
        const qname = scope.qname ? `${scope.qname}.${def.name}` : def.name;
        let id = `${file}::${def.kind}::${qname}`;
        for (let i = 2; seenIds.has(id); i++) id = `${file}::${def.kind}::${qname}#${i}`;
        seenIds.add(id);
        // Classes hash only their header so editing one method doesn't mark the whole class modified.
        const text =
          def.kind === 'class' && def.body ? n.text.slice(0, def.body.startIndex - n.startIndex) : n.text;
        const cls = def.kind === 'method' ? scope.cls : undefined;
        facts.nodes.push({
          id,
          kind: def.kind,
          label: def.kind === 'method' && cls ? `${cls}.${def.name}` : def.name,
          file,
          range: range(n),
          hash: hashText(text),
          meta: { name: def.name, qname, ...(cls ? { class: cls } : {}), ...docMeta(n, def.body) },
        });
        if (def.kind === 'class') {
          for (const b of rules.bases(n)) addRef(id, { name: b, kind: 'extends', targetKinds: ['class'] });
          childScope = { id, qname, cls: def.name };
          childInClass = true;
        } else {
          childScope = { id, qname, cls: scope.cls };
          childInClass = false;
        }
      }
      const r = rules.ref(n);
      if (r) addRef(scope.id, r);
      for (const c of n.namedChildren) {
        if (!c) continue;
        // Class members sit inside a body node (class_body / declaration_list / block).
        const passClass = childInClass || (inClass && !def && /body|declaration_list|block/.test(n.type));
        visit(c, childScope, def?.kind === 'class' ? true : passClass);
      }
    };
    visit(root, fileScope, false);
  },
};
