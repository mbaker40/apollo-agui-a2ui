import { describeComponent } from '../lib/descriptions';
import { insertTargetFor } from '../lib/surface-doc';
import { useComposerState, useStore } from '../state/context';
import { GlossaryPreview } from './glossary-previews';

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
  // Insert target derives from the unified selection (contract §7): the
  // selected component if it's a children-array container, else its nearest
  // container ancestor, else root.
  const target = insertTargetFor(state.doc, state.selectedComponentId);

  const onDragStart = (e: React.DragEvent<HTMLElement>, name: string) => {
    e.dataTransfer.setData(DRAG_MIME, name);
    e.dataTransfer.effectAllowed = 'copy';
    // The dragged ghost IS the visual: use the tile's preview element.
    // Guarded — jsdom's DataTransfer has no setDragImage.
    if (typeof e.dataTransfer.setDragImage === 'function') {
      const preview = e.currentTarget.querySelector('.gp');
      if (preview instanceof HTMLElement) {
        e.dataTransfer.setDragImage(
          preview,
          preview.offsetWidth / 2 || 30,
          preview.offsetHeight / 2 || 20,
        );
      }
    }
    store.actions.setDragging(true);
  };

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
        <ul className="glossary-grid">
          {names.map((name) => (
            <li key={name}>
              <button
                className="glossary-tile"
                data-testid={`glossary-tile-${name}`}
                draggable
                title={`${describeComponent(name)} Drag onto the canvas, or click to insert into #${target}.`}
                onDragStart={(e) => onDragStart(e, name)}
                onDragEnd={() => store.actions.setDragging(false)}
                onClick={() =>
                  store.actions.insertComponent(name, {
                    containerId: insertTargetFor(
                      store.getState().doc,
                      store.getState().selectedComponentId,
                    ),
                  })
                }
              >
                <GlossaryPreview name={name} />
                <span className="glossary-name">{name}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
