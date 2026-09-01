import { ChatPanel } from '../chat/ChatPanel';
import { useComposerState, useStore } from '../state/context';
import { Inspector } from './Inspector';

/**
 * Figma-style right sidebar (contract §7): Design (inspector) and Chat tabs.
 * Selecting a component auto-switches to Design (store.selectComponent);
 * manual tab clicks stick until the next selection. Both panels stay mounted
 * so the chat transcript survives tab switches.
 */
export function RightSidebar() {
  const store = useStore();
  const state = useComposerState();
  const tab = state.rightTab;
  return (
    <aside className="sidebar" aria-label="Design and chat sidebar">
      <div className="sidebar-tabs" role="tablist">
        <button
          role="tab"
          data-testid="tab-design"
          aria-selected={tab === 'design'}
          className={tab === 'design' ? 'active' : ''}
          onClick={() => store.actions.setRightTab('design')}
        >
          Design
        </button>
        <button
          role="tab"
          data-testid="tab-chat"
          aria-selected={tab === 'chat'}
          className={tab === 'chat' ? 'active' : ''}
          onClick={() => store.actions.setRightTab('chat')}
        >
          Chat
        </button>
      </div>
      <div className="sidebar-body" hidden={tab !== 'design'}>
        <Inspector />
      </div>
      <div className="sidebar-body" hidden={tab !== 'chat'}>
        <ChatPanel />
      </div>
    </aside>
  );
}
