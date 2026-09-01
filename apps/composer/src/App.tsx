import { useEffect } from 'react';
import { CanvasPane } from './components/CanvasPane';
import { Glossary } from './components/Glossary';
import { MobileTabBar } from './components/MobileTabBar';
import { RightSidebar } from './components/RightSidebar';
import { SettingsModal } from './components/SettingsModal';
import { useGlobalShortcuts } from './components/shortcuts';
import { watchMobile } from './lib/viewport';
import { useComposerState, useStore } from './state/context';

/**
 * Pane composition. ≥900px: the three-pane grid (glossary | canvas |
 * sidebar). ≤900px (contract §7b): a single-column app — the same three
 * panes stay mounted and the `mobile-view-*` class + CSS visibility decide
 * which one shows, so the renderer iframe survives every view switch.
 */
export default function App() {
  const store = useStore();
  const state = useComposerState();
  useGlobalShortcuts(store);
  // Track breakpoint crossings (resize / rotation) into store.mobile.
  useEffect(() => watchMobile((mobile) => store.actions.setMobile(mobile)), [store]);
  return (
    <div
      className={`app ${state.glossaryOpen ? '' : 'glossary-collapsed'} mobile-view-${state.mobileView}`}
    >
      <Glossary />
      <CanvasPane />
      <RightSidebar />
      <MobileTabBar />
      {state.toast && (
        <div
          className="mtoast"
          data-testid="mtoast"
          role="status"
          onClick={() => store.actions.dismissToast()}
        >
          {state.toast.message}
        </div>
      )}
      {state.settingsOpen && <SettingsModal />}
    </div>
  );
}
