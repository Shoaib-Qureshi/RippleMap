import * as fs from 'node:fs';
import * as path from 'node:path';
import { extractors } from '../../src/graph/extractors';
import { GraphBuilder } from '../../src/graph/GraphBuilder';
import type { Graph } from '../../src/graph/types';
import { langFor, ParserService } from '../../src/parse/ParserService';

export const WASM_DIR = path.resolve(__dirname, '../../node_modules/@vscode/tree-sitter-wasm/wasm');
export const fixture = (name: string) => path.resolve(__dirname, '../fixtures', name);

let parser: Promise<ParserService> | undefined;
export const getParser = () => (parser ??= ParserService.create(WASM_DIR));

export async function builderFor(dir: string): Promise<GraphBuilder> {
  const b = new GraphBuilder(await getParser(), extractors);
  const walk = (d: string): string[] =>
    fs
      .readdirSync(d, { withFileTypes: true })
      .flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : [path.join(d, e.name)]));
  for (const abs of walk(dir)) {
    const rel = path.relative(dir, abs).split(path.sep).join('/');
    if (langFor(rel)) b.setFile(rel, fs.readFileSync(abs, 'utf8'));
  }
  return b;
}

/** Compact, order-independent edge list: "from -> to (kind)" with ids shortened to file::name. */
export function edgeList(g: Graph, kinds?: string[]): string[] {
  const short = (id: string) => {
    const n = g.nodes.get(id)!;
    return n.kind === 'file' ? n.file : `${n.kind}:${String(n.meta?.qname ?? n.label)}`;
  };
  return [...g.edges.values()]
    .filter((e) => !kinds || kinds.includes(e.kind))
    .map((e) => `${short(e.from)} -> ${short(e.to)} (${e.kind})`)
    .sort();
}

/** "kind:qname" for every non-file node, sorted. */
export function symbolList(g: Graph): string[] {
  return [...g.nodes.values()]
    .filter((n) => n.kind !== 'file')
    .map((n) => `${n.kind}:${String(n.meta?.qname ?? n.label)}`)
    .sort();
}
