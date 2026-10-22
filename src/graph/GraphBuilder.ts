import type { ParserService } from '../parse/ParserService';
import { langFor } from '../parse/ParserService';
import { basename } from '../util/paths';
import type { Extractor } from './extractors/Extractor';
import { directive, fileDoc } from './docs';
import { hashText } from './hash';
import { resolve } from './resolve';
import { fileNodeId, type FileFacts, type Graph } from './types';

/** Owns per-file facts; `build()` turns them into the workspace graph. Pure (no vscode). */
export class GraphBuilder {
  readonly facts = new Map<string, FileFacts>();

  constructor(
    private readonly parser: ParserService,
    private readonly extractors: readonly Extractor[],
  ) {}

  /** Facts for a file's text without storing them (used for pending-edit previews too). */
  extract(file: string, text: string): FileFacts | undefined {
    const lang = langFor(file);
    if (!lang) return undefined;
    const facts: FileFacts = {
      file,
      lang,
      nodes: [
        {
          id: fileNodeId(file),
          kind: 'file',
          label: basename(file),
          file,
          hash: hashText(text),
          meta: { lang },
        },
      ],
      imports: [],
      refs: [],
      edges: [],
    };
    const tree = this.parser.parse(lang, text);
    if (!tree) return facts;
    try {
      // Shown in the UI only; not part of the hash, so it never marks a node modified.
      const meta = facts.nodes[0]!.meta!;
      const doc = fileDoc(tree.rootNode);
      const dir = directive(tree.rootNode);
      if (doc) meta.doc = doc;
      if (dir) meta.directive = dir;
      for (const x of this.extractors)
        if (x.languages.includes(lang)) x.extract({ file, lang, text, root: tree.rootNode, facts });
    } catch (e) {
      // One pathological file (e.g. 5000-deep expression chains overflow the stack) must not abort
      // indexing or a live update: keep just the file node and say why.
      facts.nodes.length = 1;
      facts.imports.length = facts.refs.length = facts.edges.length = 0;
      facts.nodes[0]!.meta!.error = e instanceof RangeError ? 'too deeply nested to analyse' : String(e);
    } finally {
      tree.delete();
    }
    return facts;
  }

  /** Returns false if the file is not a supported language. */
  setFile(file: string, text: string): boolean {
    const f = this.extract(file, text);
    if (f) this.facts.set(file, f);
    return !!f;
  }

  /** Removes a file, or everything under it when `file` is a folder (watchers report only the folder). */
  removeFile(file: string): boolean {
    if (this.facts.delete(file)) return true;
    let any = false;
    for (const f of [...this.facts.keys()]) if (f.startsWith(`${file}/`)) any = this.facts.delete(f) || any;
    return any;
  }

  build(facts: ReadonlyMap<string, FileFacts> = this.facts): Graph {
    return resolve(facts);
  }
}
