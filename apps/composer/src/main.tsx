import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { applyShellTheme } from './lib/settings';
import { StoreProvider } from './state/context';
import { createComposerStore } from './state/store';
import './styles.css';

const store = createComposerStore();
applyShellTheme(store.getState().settings.theme);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider store={store}>
      <App />
    </StoreProvider>
  </StrictMode>,
);
