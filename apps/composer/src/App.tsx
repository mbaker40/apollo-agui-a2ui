import { CanvasPane } from './components/CanvasPane';
import { Glossary } from './components/Glossary';
import { SettingsModal } from './components/SettingsModal';
import { ChatPanel } from './chat/ChatPanel';
import { useComposerState } from './state/context';

export default function App() {
  const state = useComposerState();
  return (
    <div className={`app ${state.glossaryOpen ? '' : 'glossary-collapsed'}`}>
      <Glossary />
      <CanvasPane />
      <ChatPanel />
      {state.settingsOpen && <SettingsModal />}
    </div>
  );
}
