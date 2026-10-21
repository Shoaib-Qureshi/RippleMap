import type { GraphBuilder } from '../graph/GraphBuilder';
import type { Graph } from '../graph/types';

export interface PendingPreview {
  editId: string;
  toolUseId?: string;
  file: string;
  uncertain: boolean;
  graph: Graph;
}

/**
 * Would-be workspace graph if `text` replaced `file`: extracts the proposed text in memory and resolves
 * against a copy of the facts map. Never touches disk or the builder's real facts.
 */
export function previewGraph(builder: GraphBuilder, file: string, text: string | undefined): Graph {
  const facts = new Map(builder.facts);
  const f = text === undefined ? undefined : builder.extract(file, text);
  if (f) facts.set(file, f);
  else facts.delete(file);
  return builder.build(facts);
}
