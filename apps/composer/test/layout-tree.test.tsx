import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAG_MIME } from '../src/components/Glossary';
import { LayoutTree, MOVE_MIME } from '../src/components/LayoutTree';
import { StoreProvider } from '../src/state/context';
import { createComposerStore } from '../src/state/store';

// welcome doc: root Column [welcome-card(Card → welcome-body Column
// [welcome-title, welcome-text, welcome-cta(Button → welcome-cta-label)])]

function setup() {
  const store = createComposerStore();
  render(
    <StoreProvider store={store}>
      <LayoutTree />
    </StoreProvider>,
  );
  return store;
}

/** Rows in jsdom have zero-size rects; pin one so the thirds math is real. */
function mockRect(el: HTMLElement, top = 100, height = 30) {
  el.getBoundingClientRect = () =>
    ({
      top,
      height,
      bottom: top + height,
      left: 0,
      right: 200,
      width: 200,
      x: 0,
      y: top,
      toJSON: () => ({}),
    }) as DOMRect;
}

/**
 * jsdom 30 has no DragEvent, and testing-library's fallback (plain Event)
 * drops MouseEvent fields like clientY/relatedTarget. Build the drag events
 * on MouseEvent (which carries them) and attach the dataTransfer stub the way
 * testing-library does. Returns false when the handler preventDefault-ed
 * (i.e. the target accepts the drop), mirroring fireEvent's return value.
 */
function fireDrag(
  el: HTMLElement,
  type: 'dragover' | 'drop' | 'dragleave',
  init: { clientY?: number; relatedTarget?: Element | null; dataTransfer?: unknown },
): boolean {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY: init.clientY ?? 0,
    relatedTarget: init.relatedTarget ?? null,
  });
  if (init.dataTransfer !== undefined) {
    Object.defineProperty(event, 'dataTransfer', { value: init.dataTransfer });
  }
  return fireEvent(el, event);
}

function startMoveDrag(id: string) {
  fireEvent.dragStart(screen.getByTestId(`tree-node-${id}`), {
    dataTransfer: { setData: vi.fn(), effectAllowed: '' },
  });
}

function moveDt(overrides: Record<string, unknown> = {}) {
  return { types: [MOVE_MIME], dropEffect: '', ...overrides };
}

function bodyChildren(store: ReturnType<typeof setup>) {
  return store.getState().doc.components.find((c) => c.id === 'welcome-body')!.children;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('tree rows as drag sources', () => {
  it('dragstart writes the move drag data (id), sets effectAllowed, and selects', () => {
    const store = setup();
    const btn = screen.getByTestId('tree-node-welcome-card');
    expect(btn.getAttribute('draggable')).toBe('true');
    const setData = vi.fn();
    const dt = { setData, effectAllowed: '' };
    fireEvent.dragStart(btn, { dataTransfer: dt });
    expect(setData).toHaveBeenCalledWith(MOVE_MIME, 'welcome-card');
    expect(dt.effectAllowed).toBe('move');
    expect(store.getState().selectedComponentId).toBe('welcome-card');
  });

  it('the root row is not draggable', () => {
    setup();
    expect(screen.getByTestId('tree-node-root').getAttribute('draggable')).toBe('false');
    expect(screen.getByTestId('tree-node-welcome-title').getAttribute('draggable')).toBe('true');
  });
});

describe('dragover indicators (dashed language)', () => {
  it('upper third shows the dashed insertion line before the row and accepts the drop', () => {
    setup();
    startMoveDrag('welcome-text');
    const row = screen.getByTestId('tree-row-welcome-title');
    mockRect(row);
    const dt = moveDt();
    const notPrevented = fireDrag(row, 'dragover', { clientY: 102, dataTransfer: dt });
    expect(notPrevented).toBe(false); // preventDefault → this row accepts the drop
    expect(dt.dropEffect).toBe('move');
    const line = screen.getByTestId('tree-drop-indicator');
    expect(line.nextElementSibling).toBe(row);
  });

  it('lower zone shows the insertion line after the row', () => {
    setup();
    startMoveDrag('welcome-title');
    const row = screen.getByTestId('tree-row-welcome-text');
    mockRect(row);
    fireDrag(row, 'dragover', { clientY: 125, dataTransfer: moveDt() });
    const line = screen.getByTestId('tree-drop-indicator');
    expect(line.previousElementSibling).toBe(row);
  });

  it("middle of a container row marks it 'into' with the dashed outline class", () => {
    setup();
    startMoveDrag('welcome-text');
    const row = screen.getByTestId('tree-row-root');
    mockRect(row);
    fireDrag(row, 'dragover', { clientY: 115, dataTransfer: moveDt() });
    expect(screen.getByTestId('tree-node-root').className).toContain('drop-into');
    expect(screen.queryByTestId('tree-drop-indicator')).toBeNull(); // outline, not a line
  });

  it('renders no-drop (and refuses) when canMoveTo rejects: own subtree', () => {
    const store = setup();
    const before = store.getState().doc;
    startMoveDrag('welcome-card');
    const row = screen.getByTestId('tree-row-welcome-title'); // inside the card's subtree
    mockRect(row);
    const dt = moveDt();
    const notPrevented = fireDrag(row, 'dragover', { clientY: 102, dataTransfer: dt });
    expect(notPrevented).toBe(true); // not prevented → browser refuses the drop
    expect(dt.dropEffect).toBe('none');
    expect(screen.getByTestId('tree-row-welcome-title').className).toContain('no-drop');
    expect(screen.queryByTestId('tree-drop-indicator')).toBeNull();
    // a forced drop still changes nothing (moveComponentTo re-validates)
    fireDrag(row, 'drop', {
      clientY: 102,
      dataTransfer: { getData: (t: string) => (t === MOVE_MIME ? 'welcome-card' : '') },
    });
    expect(store.getState().doc).toBe(before);
    expect(store.getState().events.some((e) => e.kind === 'error')).toBe(true);
  });

  it('renders no-drop for single-slot occupants wherever they hover', () => {
    setup();
    startMoveDrag('welcome-body'); // Card child slot occupant — canMoveTo always refuses
    const row = screen.getByTestId('tree-row-welcome-title');
    mockRect(row);
    const dt = moveDt();
    fireDrag(row, 'dragover', { clientY: 102, dataTransfer: dt });
    expect(dt.dropEffect).toBe('none');
    expect(row.className).toContain('no-drop');
  });

  it("renders no-drop for before/after zones that resolve nowhere ('into' stays fine)", () => {
    setup();
    startMoveDrag('welcome-text');
    const row = screen.getByTestId('tree-row-root');
    mockRect(row);
    const dt = moveDt();
    fireDrag(row, 'dragover', { clientY: 102, dataTransfer: dt }); // upper third of root
    expect(dt.dropEffect).toBe('none');
    expect(row.className).toContain('no-drop');
    expect(screen.queryByTestId('tree-drop-indicator')).toBeNull();
  });

  it('dragend clears every indicator', () => {
    setup();
    startMoveDrag('welcome-text');
    const row = screen.getByTestId('tree-row-welcome-title');
    mockRect(row);
    fireDrag(row, 'dragover', { clientY: 102, dataTransfer: moveDt() });
    expect(screen.getByTestId('tree-drop-indicator')).toBeTruthy();
    fireEvent.dragEnd(screen.getByTestId('tree-node-welcome-text'));
    expect(screen.queryByTestId('tree-drop-indicator')).toBeNull();
    expect(screen.getByTestId('tree-row-welcome-title').className).not.toContain('no-drop');
  });

  it('leaving the tree region clears the indicator', () => {
    setup();
    startMoveDrag('welcome-text');
    const row = screen.getByTestId('tree-row-welcome-title');
    mockRect(row);
    fireDrag(row, 'dragover', { clientY: 102, dataTransfer: moveDt() });
    expect(screen.getByTestId('tree-drop-indicator')).toBeTruthy();
    fireDrag(screen.getByLabelText('Layout tree') as HTMLElement, 'dragleave', {
      relatedTarget: document.body,
    });
    expect(screen.queryByTestId('tree-drop-indicator')).toBeNull();
  });
});

describe('dropping', () => {
  it('applies a move with after-removal indexing (source above target, same container)', () => {
    const store = setup();
    startMoveDrag('welcome-title'); // index 0 of welcome-body
    const row = screen.getByTestId('tree-row-welcome-cta');
    mockRect(row);
    // lower half of the cta leaf row → after it (raw index 3 → after-removal 2)
    fireDrag(row, 'drop', {
      clientY: 125,
      dataTransfer: { getData: (t: string) => (t === MOVE_MIME ? 'welcome-title' : '') },
    });
    expect(bodyChildren(store)).toEqual(['welcome-text', 'welcome-cta', 'welcome-title']);
    expect(store.getState().undoStack).toHaveLength(1); // one undo step per applied move
    expect(screen.queryByTestId('tree-drop-indicator')).toBeNull();
  });

  it("drops 'into' a container row at the end of its children", () => {
    const store = setup();
    startMoveDrag('welcome-title');
    const row = screen.getByTestId('tree-row-root');
    mockRect(row);
    fireDrag(row, 'drop', {
      clientY: 115, // middle third → into root
      dataTransfer: { getData: (t: string) => (t === MOVE_MIME ? 'welcome-title' : '') },
    });
    const root = store.getState().doc.components.find((c) => c.id === 'root')!;
    expect(root.children).toEqual(['welcome-card', 'welcome-title']);
    expect(bodyChildren(store)).toEqual(['welcome-text', 'welcome-cta']);
  });

  it('accepts glossary tiles as positioned inserts at the resolved spot', () => {
    const store = setup();
    act(() =>
      store.actions.bridgeUsages({
        Text: { usage: [{ id: 'root', component: 'Text', text: 'new' }] },
      }),
    );
    act(() => store.actions.setDragging(true)); // a glossary drag is in flight
    const row = screen.getByTestId('tree-row-welcome-text');
    mockRect(row);
    const dt = moveDt({ types: [DRAG_MIME] });
    const notPrevented = fireDrag(row, 'dragover', { clientY: 102, dataTransfer: dt });
    expect(notPrevented).toBe(false);
    expect(dt.dropEffect).toBe('copy');
    fireDrag(row, 'drop', {
      clientY: 102, // upper half of welcome-text → before it (index 1 of welcome-body)
      dataTransfer: { getData: (t: string) => (t === DRAG_MIME ? 'Text' : '') },
    });
    expect(bodyChildren(store)).toEqual([
      'welcome-title',
      'root-g1',
      'welcome-text',
      'welcome-cta',
    ]);
    expect(store.getState().dragging).toBe(false);
  });

  it('ignores drags carrying neither the move nor the glossary type', () => {
    setup();
    const row = screen.getByTestId('tree-row-welcome-title');
    mockRect(row);
    const dt = { types: ['text/plain'], dropEffect: '' };
    const notPrevented = fireDrag(row, 'dragover', { clientY: 102, dataTransfer: dt });
    expect(notPrevented).toBe(true);
    expect(screen.queryByTestId('tree-drop-indicator')).toBeNull();
    expect(row.className).not.toContain('no-drop');
  });
});

describe('multi-select in the tree (contract §4f)', () => {
  it('shift-click toggles rows into and out of the selection; plain click replaces', () => {
    const store = setup();
    fireEvent.click(screen.getByTestId('tree-node-welcome-title')); // plain select
    fireEvent.click(screen.getByTestId('tree-node-welcome-text'), { shiftKey: true });
    expect(store.getState().selectedComponentIds).toEqual(['welcome-title', 'welcome-text']);
    // Toggle one back out.
    fireEvent.click(screen.getByTestId('tree-node-welcome-text'), { shiftKey: true });
    expect(store.getState().selectedComponentIds).toEqual(['welcome-title']);
    // A plain click replaces the rebuilt multi-selection.
    fireEvent.click(screen.getByTestId('tree-node-welcome-text'), { shiftKey: true });
    fireEvent.click(screen.getByTestId('tree-node-welcome-cta'));
    expect(store.getState().selectedComponentIds).toEqual(['welcome-cta']);
  });

  it('highlights every selected row, the primary strongest', () => {
    const store = setup();
    act(() => {
      store.actions.toggleSelected('welcome-title');
      store.actions.toggleSelected('welcome-text');
    });
    const title = screen.getByTestId('tree-node-welcome-title');
    const text = screen.getByTestId('tree-node-welcome-text');
    expect(title.className).toContain('selected');
    expect(title.className).toContain('primary'); // first id = primary
    expect(title.getAttribute('aria-pressed')).toBe('true');
    expect(text.className).toContain('selected');
    expect(text.className).not.toContain('primary');
    expect(text.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('tree-node-welcome-cta').className).not.toContain('selected');
  });

  it('starting a row drag collapses a multi-selection to the dragged id', () => {
    const store = setup();
    act(() => {
      store.actions.toggleSelected('welcome-title');
      store.actions.toggleSelected('welcome-text');
    });
    startMoveDrag('welcome-cta');
    expect(store.getState().selectedComponentIds).toEqual(['welcome-cta']);
    expect(store.getState().selectedComponentId).toBe('welcome-cta');
  });
});

describe('tree follows the selection (contract §7 ancestor honing)', () => {
  it('scrolls the newly selected node into view', () => {
    const spy = vi.fn();
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = spy;
    try {
      const store = setup();
      act(() => store.actions.selectComponent('welcome-text'));
      expect(spy).toHaveBeenCalledWith({ block: 'nearest' });
    } finally {
      if (original) Element.prototype.scrollIntoView = original;
      else delete (Element.prototype as { scrollIntoView?: unknown }).scrollIntoView;
    }
  });
});
