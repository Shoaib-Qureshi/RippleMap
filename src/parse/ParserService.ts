import * as path from 'node:path';
import { Language, Parser, type Tree } from '@vscode/tree-sitter-wasm';
import type { Lang } from '../graph/types';

const EXT: Record<string, Lang> = {
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  ts: 'typescript',
  mts: 'typescript',
  cts: 'typescript',
  tsx: 'tsx',
  php: 'php',
  py: 'python',
};
export const SUPPORTED_EXTENSIONS = Object.keys(EXT);

export function langFor(file: string): Lang | undefined {
  if (file.endsWith('.d.ts')) return undefined;
  return EXT[file.slice(file.lastIndexOf('.') + 1).toLowerCase()];
}

let initOnce: Promise<void> | undefined;

/**
 * web-tree-sitter (WASM) parsers for JS/TS/TSX/PHP/Python.
 * ponytail: full re-parse per change, no tree cache / tree.edit(); fine for <300 ms single-file updates.
 */
export class ParserService {
  private constructor(
    private readonly parser: Parser,
    private readonly langs: Map<Lang, Language>,
  ) {}

  static async create(wasmDir: string): Promise<ParserService> {
    initOnce ??= Parser.init({ locateFile: (f: string) => path.join(wasmDir, f) });
    await initOnce;
    const langs = new Map<Lang, Language>();
    for (const l of ['javascript', 'typescript', 'tsx', 'php', 'python'] as const)
      langs.set(l, await Language.load(path.join(wasmDir, `tree-sitter-${l}.wasm`)));
    return new ParserService(new Parser(), langs);
  }

  /** Caller must `tree.delete()` when done (WASM memory). */
  parse(lang: Lang, text: string): Tree | undefined {
    this.parser.setLanguage(this.langs.get(lang)!);
    return this.parser.parse(text) ?? undefined;
  }
}
