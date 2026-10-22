import { create } from 'zustand';
import type { GraphPayload, HostToWebview, NodeKind, Summary } from '../../src/shared/messages';
import type { LayoutMode } from './layout';
import type { Level, Mode } from './view';

interface InitData {
  version: string;
  workspaceName: string | null;
  maxNodes: number;
}

export interface State {
  init: InitData | null;
  graph: GraphPayload;
  progress: { done: number; total: number } | null;
  level: Level;
  mode: Mode;
  focus: 'changed' | 'all';
  layout: LayoutMode;
  search: string;
  folder: string;
  hiddenKinds: Set<NodeKind>;
  selectedId: string | null;
  /** Symbol whose flow is shown (null = normal graph view). */
  flowRoot: string | null;
  flowDepth: number;
  /** Hide lines into shared files (used by many); hover/select reveals them. */
  simple: boolean;
  /** "Start here" panel, shown while no node is selected. */
  overviewOpen: boolean;
  /** Instructions for the AI agent, by node id. */
  notes: Record<string, string>;
  /** AI explanations, by node id. */
  summaries: Record<string, Summary>;
  showFlow(id: string | null): void;
  set(patch: Partial<State>): void;
  toggleKind(k: NodeKind): void;
  receive(msg: HostToWebview): void;
}

export const useStore = create<State>((set, get) => ({
  init: null,
  graph: {
    nodes: [],
    edges: [],
    summary: '',
    counts: { addedNodes: 0, removedNodes: 0, modifiedNodes: 0, addedEdges: 0, removedEdges: 0 },
    step: null,
    steps: [],
    pending: null,
    insights: [],
    agent: null,
  },
  notes: {},
  summaries: {},
  progress: null,
  level: 'files',
  mode: 'diff',
  focus: 'changed',
  layout: 'LR',
  search: '',
  folder: '',
  hiddenKinds: new Set(),
  selectedId: null,
  flowRoot: null,
  flowDepth: 3,
  simple: true,
  overviewOpen: true,
  showFlow: (id) => set(id ? { flowRoot: id, selectedId: id } : { flowRoot: null }),
  set: (patch) => set(patch),
  toggleKind: (k) => {
    const s = new Set(get().hiddenKinds);
    if (s.has(k)) s.delete(k);
    else s.add(k);
    set({ hiddenKinds: s });
  },
  receive: (msg) => {
    switch (msg.type) {
      case 'init':
        set({ init: { version: msg.version, workspaceName: msg.workspaceName, maxNodes: msg.maxNodes } });
        break;
      case 'graph:update': {
        // A selection / flow root whose node is gone would leave an empty drawer or a flow that silently
        // turns back on later: drop them.
        const ids = new Set(msg.graph.nodes.map((n) => n.id));
        const { selectedId, flowRoot } = get();
        set({
          graph: msg.graph,
          ...(selectedId && !ids.has(selectedId) ? { selectedId: null } : {}),
          ...(flowRoot && !ids.has(flowRoot) ? { flowRoot: null } : {}),
        });
        break;
      }
      case 'summaries':
        set({ summaries: msg.summaries });
        break;
      case 'notes':
        set({ notes: msg.notes });
        break;
      case 'index:progress':
        set({ progress: msg.done >= msg.total ? null : { done: msg.done, total: msg.total } });
        break;
    }
  },
}));
