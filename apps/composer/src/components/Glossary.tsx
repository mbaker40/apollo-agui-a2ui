import { describeComponent } from '../lib/descriptions';
import { useComposerState, useStore } from '../state/context';

export const DRAG_MIME = 'application/x-composerx-component';

export function Glossary() {
  const store = useStore();
  const state = useComposerState();
  const usages = state.handshake.usages;

  if (!state.glossaryOpen) {
    return (
      <aside className="glossary collapsed">
        <button
          className="icon-button"
          title="Expand glossary"
          aria-label="Expand glossary"
          onClick={() => store.actions.toggleGlossary()}
        >
          ›
        </button>
      </aside>
    );
  }

  const names = usages ? Object.keys(usages).sort() : [];

  return (
    <aside className="glossary" aria-label="Component glossary">
      <header className="pane-header">
        <h2>Glossary</h2>
        <button
          className="icon-button"
          title="Collapse glossary"
          aria-label="Collapse glossary"
          onClick={() => store.actions.toggleGlossary()}
        >
          ‹
        </button>
      </header>
      {names.length === 0 ? (
        <p className="empty-note">
          Waiting for component usages from the renderer… Entries appear once the COMPONENT_USAGES
          handshake completes.
        </p>
      ) : (
        <ul className="glossary-list">
          {names.map((name) => (
            <li key={name}>
              <button
                className="glossary-entry"
                draggable
                title={`Drag onto the canvas, or click to insert into ${state.selectedContainerId}`}
                onDragStart={(e) => {
                  e.dataTransfer.setData(DRAG_MIME, name);
                  e.dataTransfer.effectAllowed = 'copy';
                  store.actions.setDragging(true);
                }}
                onDragEnd={() => store.actions.setDragging(false)}
                onClick={() =>
                  store.actions.insertComponent(name, {
                    containerId: state.selectedContainerId,
                  })
                }
              >
                <span className="glossary-name">{name}</span>
                <span className="glossary-desc">{describeComponent(name)}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
