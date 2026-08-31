import { useEffect, useState } from 'react';
import { MODELS, STORAGE_KEYS, readSetting, writeSetting } from '../lib/settings';
import { useComposerState, useStore } from '../state/context';

export function SettingsModal() {
  const store = useStore();
  const state = useComposerState();
  const [urlDraft, setUrlDraft] = useState(state.settings.rendererUrl);
  const [mockLlm, setMockLlm] = useState(readSetting(STORAGE_KEYS.mockLlm) === '1');
  const close = () => store.actions.setSettingsOpen(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // close is stable for the life of the modal (store identity does not change)
  }, []);

  const applyUrl = () => {
    const trimmed = urlDraft.trim();
    if (trimmed && trimmed !== state.settings.rendererUrl) {
      store.actions.setRendererUrl(trimmed);
    }
  };

  return (
    <div className="modal-backdrop" onClick={close}>
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="pane-header">
          <h2>Settings</h2>
          <button className="icon-button" onClick={close} aria-label="Close settings">
            ✕
          </button>
        </header>

        <label className="field">
          <span>Renderer URL</span>
          <div className="field-row">
            <input
              type="text"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
              onBlur={applyUrl}
              onKeyDown={(e) => {
                if (e.key === 'Enter') applyUrl();
              }}
              placeholder="http://localhost:7465/"
            />
            <button
              onClick={() => {
                store.actions.setRendererUrl(null);
                setUrlDraft(store.getState().settings.rendererUrl);
              }}
            >
              Reset to default
            </button>
          </div>
          <span className="hint">
            Changing the URL remounts the renderer iframe and re-runs the handshake. Any
            bridge-compatible renderer works (BYO renderer).
          </span>
        </label>

        <label className="field">
          <span>Anthropic API key</span>
          <input
            type="password"
            autoComplete="off"
            value={state.settings.apiKey}
            onChange={(e) => store.actions.setApiKey(e.target.value)}
            placeholder="sk-ant-…"
          />
          <span className="hint">
            Stored locally under {STORAGE_KEYS.apiKey}; used in-browser only.
          </span>
        </label>

        <label className="field">
          <span>Model</span>
          <select
            value={state.settings.model}
            onChange={(e) => store.actions.setModel(e.target.value)}
          >
            {MODELS.map((model) => (
              <option key={model.id} value={model.id}>
                {model.label}
              </option>
            ))}
          </select>
        </label>

        <label className="field checkbox-field">
          <input
            type="checkbox"
            checked={mockLlm}
            onChange={(e) => {
              setMockLlm(e.target.checked);
              writeSetting(STORAGE_KEYS.mockLlm, e.target.checked ? '1' : null);
            }}
          />
          <span>Use the recorded mock LLM (no API key needed)</span>
        </label>
      </div>
    </div>
  );
}
