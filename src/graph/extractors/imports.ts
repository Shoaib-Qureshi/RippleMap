import type { Node } from '@vscode/tree-sitter-wasm';
import { stringValue, walk, type Extractor } from './Extractor';

/** File-level dependencies: ESM/CJS imports, PHP include/require/use, Python imports. */
export const importsExtractor: Extractor = {
  id: 'imports',
  languages: ['javascript', 'typescript', 'tsx', 'php', 'python'],
  extract({ lang, root, facts }) {
    const add = facts.imports.push.bind(facts.imports);
    if (lang === 'php') {
      walk(root, (n) => {
        if (/^(include|require)(_once)?_expression$/.test(n.type)) {
          // `__DIR__ . '/x.php'`, `plugin_dir_path(__FILE__) . 'x.php'`, `'x.php'`: the last string is the path.
          const strings = n.descendantsOfType(['string', 'encapsed_string']);
          const spec = stringValue(strings[strings.length - 1]);
          if (spec) add({ kind: 'php-include', spec });
          return false;
        }
        if (n.type === 'namespace_use_clause') {
          const name = n.namedChildren.find((c) => c?.type === 'qualified_name' || c?.type === 'name')?.text;
          if (name) add({ kind: 'php-use', spec: name.slice(name.lastIndexOf('\\') + 1) });
          return false;
        }
      });
      return;
    }
    if (lang === 'python') {
      walk(root, (n) => {
        if (n.type === 'import_statement') {
          for (const c of n.namedChildren) {
            const name =
              c?.type === 'aliased_import'
                ? c.childForFieldName('name')?.text
                : c?.type === 'dotted_name'
                  ? c.text
                  : undefined;
            if (name) add({ kind: 'py', spec: name });
          }
          return false;
        }
        if (n.type === 'import_from_statement') {
          const mod = n.childForFieldName('module_name');
          if (!mod) return false;
          const names = n
            .childrenForFieldName('name')
            .map((c: Node | null) =>
              c?.type === 'aliased_import' ? c.childForFieldName('name')?.text : c?.text,
            )
            .filter((x): x is string => !!x);
          add({ kind: 'py', spec: mod.text, names });
          return false;
        }
      });
      return;
    }
    walk(root, (n) => {
      if (n.type === 'import_statement' || (n.type === 'export_statement' && n.childForFieldName('source'))) {
        const spec = stringValue(n.childForFieldName('source'));
        if (spec) add({ kind: 'js', spec });
        return false;
      }
      if (n.type === 'call_expression') {
        const fn = n.childForFieldName('function');
        if (fn?.type === 'import' || (fn?.type === 'identifier' && fn.text === 'require')) {
          const spec = stringValue(n.childForFieldName('arguments')?.namedChildren[0]);
          if (spec) add({ kind: 'js', spec });
        }
      }
    });
  },
};
