import type { ParserService } from '../parse/ParserService';
import { langFor } from '../parse/ParserService';
import { basename } from '../util/paths';
import type { Extractor } from './extractors/Extractor';
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
      for (const x of this.extractors)
        if (x.languages.includes(lang)) x.extract({ file, lang, text, root: tree.rootNode, facts });
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

  removeFile(file: string): boolean {
    return this.facts.delete(file);
  }

  build(facts: ReadonlyMap<string, FileFacts> = this.facts): Graph {
    return resolve(facts);
  }
}
