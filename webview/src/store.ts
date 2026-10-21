import { create } from 'zustand';
import type { HostToWebview } from '../../src/shared/messages';

type InitData = Omit<Extract<HostToWebview, { type: 'init' }>, 'type'>;

interface State {
  init: InitData | null;
  receive(msg: HostToWebview): void;
}

export const useStore = create<State>((set) => ({
  init: null,
  receive: (msg) => {
    switch (msg.type) {
      case 'init':
        set({ init: { version: msg.version, workspaceName: msg.workspaceName } });
        break;
    }
  },
}));
