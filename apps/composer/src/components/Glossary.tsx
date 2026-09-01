import { useEffect, useRef } from 'react';
import { describeComponent } from '../lib/descriptions';
import { insertTargetFor } from '../lib/surface-doc';
import type { CanvasDndRect } from '../state/store';
import { useComposerState, useStore } from '../state/context';
import { GlossaryPreview } from './glossary-previews';

export const DRAG_MIME = 'application/x-composerx-component';

/** One in-flight grip drag (contract §7b). Multi-touch extras are ignored. */
interface GripDrag {
  pointerId: number;
  name: string;
  ghost: HTMLElement;
  /** Whether the previous move was inside the iframe rect (edge-detects END). */
  overCanvas: boolean;
}

function pointInRect(rect: CanvasDndRect, x: number, y: number): boolean {
  return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
}

/**
 * Fixed-position, pointer-events-none clone of the tile that floats under
 * the pointer during a grip drag. Identity attributes are stripped so the
 * clone can never shadow the real tile (duplicate testids, drag handlers).
 */
function buildGhost(grip: HTMLElement, name: string): HTMLElement {
  const ghost = document.createElement('div');
  ghost.className = 'glossary-drag-ghost';
  const tile = grip.closest('li')?.querySelector('.glossary-tile');
  if (tile instanceof HTMLElement) {
    const clone = tile.cloneNode(true) as HTMLElement;
    clone.removeAttribute('data-testid');
    clone.removeAttribute('draggable');
    clone.removeAttribute('title');
    for (const el of clone.querySelectorAll('[data-testid]')) {
      el.removeAttribute('data-testid');
    }
    ghost.appendChild(clone);
  } else {
    ghost.textContent = name;
  }
  return ghost;
}

function placeGhost(ghost: HTMLElement, x: number, y: number): void {
  ghost.style.left = `${x}px`;
  ghost.style.top = `${y}px`;
}

export function Glossary() {
  const store = useStore();
  const state = useComposerState();
  const usages = state.handshake.usages;
  const gripDragRef = useRef<GripDrag | null>(null);

  // Unmount safety: never leave an orphaned ghost in <body>.
  useEffect(
    () => () => {
      gripDragRef.current?.ghost.remove();
      gripDragRef.current = null;
    },
    [],
  );

  /**
   * Pointer-based positional drag from the grip (contract §7b): starts
   * immediately on pointerdown (no long-press), captures the pointer so the
   * grip receives every move/up even while the finger crosses other panes,
   * and funnels drops into the same insertFromDrag path as the HTML5 overlay.
   * Works for touch AND mouse under the breakpoint (grips are CSS-hidden
   * ≥900px, where HTML5 tile drag remains the drag surface).
   */
  const onGripPointerDown = (e: React.PointerEvent<HTMLButtonElement>, name: string) => {
    if (gripDragRef.current) return; // one drag at a time
    if (e.button !== 0) return; // primary button / any touch
    e.preventDefault();
    const grip = e.currentTarget;
    // jsdom has no setPointerCapture; real browsers route all further
    // pointer events for this pointerId to the grip (same §4e veil pattern).
    if (typeof grip.setPointerCapture === 'function') {
      try {
        grip.setPointerCapture(e.pointerId);
      } catch {
        /* capture unavailable — window-bubbled events still reach us */
      }
    }
    const ghost = buildGhost(grip, name);
    placeGhost(ghost, e.clientX, e.clientY);
    document.body.appendChild(ghost);
    gripDragRef.current = { pointerId: e.pointerId, name, ghost, overCanvas: false };
    store.actions.setDragging(true);
    // The iframe must be visible to drop on: switch to the Canvas view
    // immediately at drag start (contract §7b). The glossary stays mounted
    // (CSS visibility), so the captured gesture keeps streaming events.
    const s = store.getState();
    if (s.mobile && s.mobileView !== 'canvas') store.actions.setMobileView('canvas');
  };

  const onGripPointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = gripDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    placeGhost(drag.ghost, e.clientX, e.clientY);
    const surface = store.getCanvasDnd();
    const rect = surface?.getIframeRect() ?? null;
    if (surface && rect && pointInRect(rect, e.clientX, e.clientY)) {
      drag.overCanvas = true;
      // Same conversion + rAF throttle as the overlay's dragover path.
      surface.hoverAt(e.clientX, e.clientY);
    } else if (drag.overCanvas) {
      drag.overCanvas = false;
      surface?.endHover(); // mirror onOverlayDragLeave: clear indicators + held target
    }
  };

  const finishGripDrag = (dropAt: { x: number; y: number } | null) => {
    const drag = gripDragRef.current;
    if (!drag) return;
    gripDragRef.current = null;
    drag.ghost.remove();
    if (dropAt) {
      const surface = store.getCanvasDnd();
      const rect = surface?.getIframeRect() ?? null;
      if (surface && rect && pointInRect(rect, dropAt.x, dropAt.y)) {
        // Same held-target-or-structural-fallback insert as the HTML5 drop.
        store.actions.insertFromDrag(drag.name, surface.currentTarget());
      }
    }
    // dragging=false makes CanvasPane send COMPOSERX_DND_END + clear the
    // held target (its existing effect) — identical to HTML5 dragend.
    store.actions.setDragging(false);
  };

  const onGripPointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = gripDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    finishGripDrag({ x: e.clientX, y: e.clientY });
  };

  const onGripPointerCancel = (e: React.PointerEvent<HTMLButtonElement>) => {
    const drag = gripDragRef.current;
    if (!drag || e.pointerId !== drag.pointerId) return;
    finishGripDrag(null); // cancelled: clean up, never insert
  };

  if (!state.glossaryOpen) {
    return (
      <aside className="glossary collapsed">
        <button
          className="icon-button glossary-expand"
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
          className="icon-button glossary-collapse"
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
            <li key={name} className="glossary-item">
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
              <button
                className="glossary-grip"
                data-testid={`glossary-grip-${name}`}
                aria-label={`Drag ${name} to a canvas position`}
                onPointerDown={(e) => onGripPointerDown(e, name)}
                onPointerMove={onGripPointerMove}
                onPointerUp={onGripPointerUp}
                onPointerCancel={onGripPointerCancel}
              >
                <span className="grip-glyph" aria-hidden>
                  ⠿
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
