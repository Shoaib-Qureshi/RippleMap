export type NodeKind =
  'file' | 'function' | 'method' | 'class' | 'hook' | 'route' | 'shortcode' | 'component';
export type EdgeKind = 'imports' | 'calls' | 'registers' | 'renders' | 'extends';
export type Confidence = 'high' | 'medium' | 'low';
export type Lang = 'javascript' | 'typescript' | 'tsx' | 'php' | 'python';

export interface GraphNode {
  id: string; // stable: `${file}::${kind}::${name}`; global framework nodes use `wp::hook::init` etc.
  kind: NodeKind;
  label: string;
  file: string; // workspace-relative, forward slashes
  range?: { startLine: number; endLine: number }; // 1-based
  /** Content hash: same id + different hash = modified. Line shifts alone don't count. */
  hash?: string;
  meta?: Record<string, unknown>;
}

export interface GraphEdge {
  id: string;
  from: string;
  to: string;
  kind: EdgeKind;
  confidence: Confidence;
}

export interface Graph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, GraphEdge>;
}

export interface SerializedGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

export const emptyGraph = (): Graph => ({ nodes: new Map(), edges: new Map() });
export const serialize = (g: Graph): SerializedGraph => ({
  nodes: [...g.nodes.values()],
  edges: [...g.edges.values()],
});
export const deserialize = (s: SerializedGraph): Graph => ({
  nodes: new Map(s.nodes.map((n) => [n.id, n])),
  edges: new Map(s.edges.map((e) => [e.id, e])),
});

export const fileNodeId = (file: string) => `${file}::file::${file}`;
export const edgeId = (from: string, to: string, kind: EdgeKind) => `${from}->${to}::${kind}`;

/** Unresolved import: turned into a file->file edge by the resolver. */
export interface ImportFact {
  kind: 'js' | 'php-include' | 'php-use' | 'py';
  spec: string;
  /** Python `from x import a, b`: names may be submodules. */
  names?: string[];
}

/** Reference by name, resolved against all definitions in the workspace. */
export interface RefFact {
  from: string; // node id
  name: string;
  kind: EdgeKind;
  /** `this.x()` / `$this->x()` / `self.x()`: prefer methods of the same class. */
  receiver?: 'self' | 'other';
  /** Restrict candidates to these node kinds. */
  targetKinds?: NodeKind[];
}

/** Everything one file contributes. Rebuilt whenever the file changes. */
export interface FileFacts {
  file: string;
  lang: Lang;
  nodes: GraphNode[]; // the file node first
  imports: ImportFact[];
  refs: RefFact[];
  /** Edges whose endpoints are already known ids (e.g. hook -> callback in the same file). */
  edges: GraphEdge[];
}
