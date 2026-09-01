import { createContext, useContext, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { ComposerState, ComposerStore } from './store';

const StoreContext = createContext<ComposerStore | null>(null);

export function StoreProvider({ store, children }: { store: ComposerStore; children: ReactNode }) {
  return <StoreContext.Provider value={store}>{children}</StoreContext.Provider>;
}

export function useStore(): ComposerStore {
  const store = useContext(StoreContext);
  if (!store) throw new Error('useStore must be used inside a StoreProvider');
  return store;
}

export function useComposerState(): ComposerState {
  const store = useStore();
  return useSyncExternalStore(store.subscribe, store.getState, store.getState);
}
