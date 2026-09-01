import { useEffect, useRef, useState } from 'react';
import { toRenderMessages } from '../lib/surface-doc';
import type { DrawerTab, EventEntry } from '../state/store';
import { useComposerState, useStore } from '../state/context';

function docJson(doc: Parameters<typeof toRenderMessages>[0]): string {
  return JSON.stringify(toRenderMessages(doc), null, 2);
}

function JsonTab() {
  const store = useStore();
  const state = useComposerState();
  const [text, setText] = useState(() => docJson(state.doc));
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastRevision = useRef(state.docRevision);

  // Pristine textarea follows doc changes; user edits hold until Apply/Reset.
  useEffect(() => {
    if (state.docRevision !== lastRevision.current) {
      lastRevision.current = state.docRevision;
      if (!dirty) {
        setText(docJson(state.doc));
        setError(null);
      }
    }
  }, [state.docRevision, state.doc, dirty]);

  const apply = () => {
    const result = store.actions.applyJsonText(text);
    if (result.ok) {
      setDirty(false);
      setError(null);
      setText(docJson(store.getState().doc));
    } else {
      setError(result.error);
    }
  };

  const format = () => {
    try {
      setText(JSON.stringify(JSON.parse(text), null, 2));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const reset = () => {
    setText(docJson(state.doc));
    setDirty(false);
    setError(null);
  };

  return (
    <div className="json-tab">
      <div className="json-actions">
        <button onClick={apply} data-testid="json-apply">
          Apply
        </button>
        <button onClick={format} data-testid="json-format">
          Format
        </button>
        <button onClick={reset} data-testid="json-reset">
          Reset
        </button>
        {dirty && (
          <span className="badge" data-testid="json-modified">
            modified
          </span>
        )}
        {error && (
          <span className="error-text" data-testid="json-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <textarea
        className="json-editor"
        data-testid="json-editor"
        aria-label="Layout JSON"
        spellCheck={false}
        value={text}
        onChange={(e) => {
          setText(e.target.value);
          setDirty(true);
        }}
      />
    </div>
  );
}

function DataTab() {
  const state = useComposerState();
  const model = state.rendererDataModel ?? state.doc.dataModel;
  const source = state.rendererDataModel
    ? 'live DATA_MODEL_CHANGE snapshot'
    : 'document data model';
  return (
    <div className="data-tab">
      <p className="muted">{source}</p>
      <pre className="data-view" data-testid="data-view">
        {JSON.stringify(model, null, 2)}
      </pre>
    </div>
  );
}

function levelClass(entry: EventEntry): string {
  if (entry.kind === 'error') return 'lvl-error';
  if (entry.kind === 'console') {
    if (entry.level === 'error') return 'lvl-error';
    if (entry.level === 'warn') return 'lvl-warn';
  }
  return '';
}

function EventsTab() {
  const state = useComposerState();
  if (state.events.length === 0) {
    return <p className="empty-note">No events yet.</p>;
  }
  return (
    <ul className="event-list" data-testid="event-list">
      {state.events.map((entry) => (
        <li key={entry.id} className={`event-row ${levelClass(entry)}`}>
          <span className="event-time">
            {new Date(entry.ts).toLocaleTimeString(undefined, { hour12: false })}
          </span>
          <span className={`event-kind kind-${entry.kind}`}>
            {entry.kind === 'console' ? (entry.level ?? 'log') : entry.kind}
          </span>
          <span className="event-summary">
            {entry.summary}
            {entry.detail && <span className="event-detail"> — {entry.detail}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

const TABS: { id: DrawerTab; label: string }[] = [
  { id: 'json', label: 'Layout JSON' },
  { id: 'data', label: 'Data model' },
  { id: 'events', label: 'Events' },
];

export function Drawer() {
  const store = useStore();
  const state = useComposerState();
  return (
    <div className={`drawer ${state.drawerOpen ? 'open' : ''}`}>
      <div className="drawer-tabs" role="tablist">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            role="tab"
            aria-selected={state.drawerOpen && state.drawerTab === tab.id}
            className={state.drawerOpen && state.drawerTab === tab.id ? 'active' : ''}
            onClick={() => store.actions.setDrawerTab(tab.id)}
          >
            {tab.label}
          </button>
        ))}
        <span className="toolbar-spacer" />
        <button
          className="icon-button"
          title={state.drawerOpen ? 'Collapse drawer' : 'Expand drawer'}
          aria-label={state.drawerOpen ? 'Collapse drawer' : 'Expand drawer'}
          onClick={() => store.actions.setDrawerOpen(!state.drawerOpen)}
        >
          {state.drawerOpen ? '▾' : '▴'}
        </button>
      </div>
      {state.drawerOpen && (
        <div className="drawer-body">
          {state.drawerTab === 'json' && <JsonTab />}
          {state.drawerTab === 'data' && <DataTab />}
          {state.drawerTab === 'events' && <EventsTab />}
        </div>
      )}
    </div>
  );
}
