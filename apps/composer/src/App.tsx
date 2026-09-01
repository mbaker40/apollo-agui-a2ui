import { CanvasPane } from './components/CanvasPane';
import { Glossary } from './components/Glossary';
import { RightSidebar } from './components/RightSidebar';
import { SettingsModal } from './components/SettingsModal';
import { useGlobalShortcuts } from './components/shortcuts';
import { useComposerState, useStore } from './state/context';

export default function App() {
  const store = useStore();
  const state = useComposerState();
  useGlobalShortcuts(store);
  return (
    <div className={`app ${state.glossaryOpen ? '' : 'glossary-collapsed'}`}>
      <Glossary />
      <CanvasPane />
      <RightSidebar />
      {state.settingsOpen && <SettingsModal />}
    </div>
  );
}
