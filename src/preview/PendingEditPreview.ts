import type { GraphBuilder } from '../graph/GraphBuilder';
import type { FileFacts, Graph } from '../graph/types';

export interface PendingPreview {
  editId: string;
  toolUseId?: string;
  file: string;
  uncertain: boolean;
  graph: Graph;
  facts: ReadonlyMap<string, FileFacts>;
}

/**
 * Would-be workspace graph if `text` replaced `file`: extracts the proposed text in memory and resolves
 * against a copy of the facts map. Never touches disk or the builder's real facts.
 */
export function previewGraph(
  builder: GraphBuilder,
  file: string,
  text: string | undefined,
): { graph: Graph; facts: ReadonlyMap<string, FileFacts> } {
  const facts = new Map(builder.facts);
  const f = text === undefined ? undefined : builder.extract(file, text);
  if (f) facts.set(file, f);
  else facts.delete(file);
  return { graph: builder.build(facts), facts };
}
