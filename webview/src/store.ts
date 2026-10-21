import { create } from 'zustand';
import type { GraphPayload, HostToWebview, NodeKind } from '../../src/shared/messages';
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
  },
  progress: null,
  level: 'files',
  mode: 'diff',
  focus: 'changed',
  layout: 'LR',
  search: '',
  folder: '',
  hiddenKinds: new Set(),
  selectedId: null,
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
      case 'graph:update':
        set({ graph: msg.graph });
        break;
      case 'index:progress':
        set({ progress: msg.done >= msg.total ? null : { done: msg.done, total: msg.total } });
        break;
    }
  },
}));
