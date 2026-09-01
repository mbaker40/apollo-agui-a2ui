import type { MobileView } from '../state/store';
import { useComposerState, useStore } from '../state/context';

const TABS: { id: MobileView; label: string }[] = [
  { id: 'canvas', label: 'Canvas' },
  { id: 'add', label: 'Add' },
  { id: 'design', label: 'Design' },
  { id: 'chat', label: 'Chat' },
];

/**
 * Fixed bottom tab bar for the ≤900px single-column layout (contract §7b):
 * Canvas · Add · Design · Chat, ≥48px rows, safe-area padded, hidden ≥900px
 * via CSS. Switching views only toggles CSS visibility on the panes — the
 * canvas pane (and its renderer iframe) stays mounted, so the bridge
 * handshake never replays.
 */
export function MobileTabBar() {
  const store = useStore();
  const state = useComposerState();
  return (
    <nav className="mobile-tabbar" aria-label="Composer views">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          data-testid={`mtab-${tab.id}`}
          aria-pressed={state.mobileView === tab.id}
          className={state.mobileView === tab.id ? 'active' : ''}
          onClick={() => store.actions.setMobileView(tab.id)}
        >
          {tab.label}
        </button>
      ))}
    </nav>
  );
}
