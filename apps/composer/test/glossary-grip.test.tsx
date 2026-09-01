/**
 * Grip pointer-drag (contract §7b): pointerdown on a tile's grip starts an
 * immediate pointer-based drag — a ghost follows the pointer, hovers over
 * the iframe rect drive the shared CanvasDndSurface (the same
 * sendDndHover/sendDndEnd + held DND_TARGET path as HTML5 drag), and
 * pointerup over the iframe inserts via the shared insertFromDrag path.
 *
 * jsdom notes: PointerEvent exists (fireEvent.pointerDown passes pointerId
 * and clientX/Y through), but elements lack setPointerCapture — production
 * code guards with a typeof check (the §4e veil pattern); tests stub it.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DndTargetPayload } from '../src/lib/bridge-host';
import { Glossary } from '../src/components/Glossary';
import { StoreProvider } from '../src/state/context';
import { createComposerStore } from '../src/state/store';

const USAGES = {
  Text: { usage: [{ id: 'root', component: 'Text', text: 'hi' }] },
};

/** Fake iframe rect in viewport CSS px (what getBoundingClientRect returns). */
const RECT = { left: 100, top: 200, right: 400, bottom: 500 };
const INSIDE = { clientX: 150, clientY: 250 };
const OUTSIDE = { clientX: 10, clientY: 10 };

function setup(mobile = true) {
  const store = createComposerStore({ mobile });
  store.attachPort({
    sendRender: () => {},
    sendTheme: () => {},
    sendSetMode: () => {},
    sendSetSelection: () => {},
  });
  const hoverCalls: { x: number; y: number }[] = [];
  let endCount = 0;
  let target: DndTargetPayload | null = null;
  store.attachCanvasDnd({
    getIframeRect: () => RECT,
    hoverAt: (x, y) => hoverCalls.push({ x, y }),
    endHover: () => {
      endCount += 1;
      target = null;
    },
    currentTarget: () => target,
  });
  render(
    <StoreProvider store={store}>
      <Glossary />
    </StoreProvider>,
  );
  act(() => store.actions.bridgeUsages(USAGES));
  return {
    store,
    hoverCalls,
    endsSeen: () => endCount,
    setTarget: (t: DndTargetPayload | null) => {
      target = t;
    },
  };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('glossary grip pointer drag', () => {
  it('renders a grip per tile with its testid', () => {
    setup();
    expect(screen.getByTestId('glossary-grip-Text')).toBeTruthy();
  });

  it('pointerdown captures the pointer, floats a ghost, and switches mobile to the canvas view', () => {
    const { store } = setup();
    act(() => store.actions.setMobileView('add'));
    const grip = screen.getByTestId('glossary-grip-Text');
    const capture = vi.fn();
    (grip as unknown as { setPointerCapture: typeof capture }).setPointerCapture = capture;
    fireEvent.pointerDown(grip, { pointerId: 1, ...OUTSIDE, button: 0 });
    expect(capture).toHaveBeenCalledWith(1);
    expect(store.getState().dragging).toBe(true);
    expect(store.getState().mobileView).toBe('canvas'); // iframe must be visible to drop on
    const ghost = document.body.querySelector('.glossary-drag-ghost');
    expect(ghost).toBeTruthy();
    // The ghost clone must never shadow the real tile in testid queries.
    expect(screen.getAllByTestId('glossary-tile-Text')).toHaveLength(1);
    fireEvent.pointerUp(grip, { pointerId: 1, ...OUTSIDE });
  });

  it('drives hoverAt while over the iframe rect and endHover once on leaving it', () => {
    const { hoverCalls, endsSeen } = setup();
    const grip = screen.getByTestId('glossary-grip-Text');
    fireEvent.pointerDown(grip, { pointerId: 1, ...OUTSIDE, button: 0 });
    fireEvent.pointerMove(grip, { pointerId: 1, ...INSIDE });
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 160, clientY: 260 });
    expect(hoverCalls).toEqual([
      { x: 150, y: 250 },
      { x: 160, y: 260 },
    ]);
    fireEvent.pointerMove(grip, { pointerId: 1, ...OUTSIDE });
    fireEvent.pointerMove(grip, { pointerId: 1, clientX: 11, clientY: 11 });
    expect(endsSeen()).toBe(1); // edge-detected, not per-move
    // moves from other pointers (multi-touch) are ignored
    fireEvent.pointerMove(grip, { pointerId: 9, ...INSIDE });
    expect(hoverCalls).toHaveLength(2);
    fireEvent.pointerUp(grip, { pointerId: 1, ...OUTSIDE });
  });

  it('pointerup over the iframe inserts via the held sidecar target (+ toast on mobile)', () => {
    const { store, setTarget } = setup();
    const grip = screen.getByTestId('glossary-grip-Text');
    fireEvent.pointerDown(grip, { pointerId: 2, ...OUTSIDE, button: 0 });
    fireEvent.pointerMove(grip, { pointerId: 2, ...INSIDE });
    setTarget({
      targetId: 'welcome-title',
      containerId: 'welcome-body',
      index: 0,
      slot: 'before',
      rect: null,
    });
    fireEvent.pointerUp(grip, { pointerId: 2, ...INSIDE });
    const body = store.getState().doc.components.find((c) => c.id === 'welcome-body')!;
    expect((body.children as string[])[0]).toBe('root-g1');
    expect(store.getState().dragging).toBe(false);
    expect(store.getState().toast?.message).toBe('Text → #welcome-body');
    expect(document.body.querySelector('.glossary-drag-ghost')).toBeNull();
  });

  it('pointerup over the iframe with no held target uses the structural fallback', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('welcome-title')); // leaf → welcome-body
    const grip = screen.getByTestId('glossary-grip-Text');
    fireEvent.pointerDown(grip, { pointerId: 3, ...OUTSIDE, button: 0 });
    fireEvent.pointerUp(grip, { pointerId: 3, ...INSIDE });
    const bodyComp = store.getState().doc.components.find((c) => c.id === 'welcome-body')!;
    expect(bodyComp.children).toContain('root-g1');
  });

  it('pointerup outside the iframe cleans up without inserting', () => {
    const { store } = setup();
    const before = store.getState().doc.components.length;
    const grip = screen.getByTestId('glossary-grip-Text');
    fireEvent.pointerDown(grip, { pointerId: 4, ...OUTSIDE, button: 0 });
    fireEvent.pointerMove(grip, { pointerId: 4, ...INSIDE });
    fireEvent.pointerUp(grip, { pointerId: 4, ...OUTSIDE });
    expect(store.getState().doc.components).toHaveLength(before);
    expect(store.getState().dragging).toBe(false);
    expect(document.body.querySelector('.glossary-drag-ghost')).toBeNull();
  });

  it('pointercancel aborts the drag without inserting', () => {
    const { store } = setup();
    const before = store.getState().doc.components.length;
    const grip = screen.getByTestId('glossary-grip-Text');
    fireEvent.pointerDown(grip, { pointerId: 5, ...OUTSIDE, button: 0 });
    fireEvent.pointerMove(grip, { pointerId: 5, ...INSIDE });
    fireEvent.pointerCancel(grip, { pointerId: 5, ...INSIDE });
    expect(store.getState().doc.components).toHaveLength(before);
    expect(store.getState().dragging).toBe(false);
    expect(document.body.querySelector('.glossary-drag-ghost')).toBeNull();
  });

  it('works with a mouse on a desktop store too (no view switch, no toast)', () => {
    const { store } = setup(false);
    const grip = screen.getByTestId('glossary-grip-Text');
    fireEvent.pointerDown(grip, { pointerId: 6, ...OUTSIDE, button: 0, pointerType: 'mouse' });
    fireEvent.pointerUp(grip, { pointerId: 6, ...INSIDE, pointerType: 'mouse' });
    const root = store.getState().doc.components.find((c) => c.id === 'root')!;
    expect(root.children).toContain('root-g1');
    expect(store.getState().mobileView).toBe('canvas');
    expect(store.getState().toast).toBeNull();
  });

  it('ignores secondary-button presses and re-entrant pointerdowns', () => {
    const { store } = setup();
    const grip = screen.getByTestId('glossary-grip-Text');
    fireEvent.pointerDown(grip, { pointerId: 7, ...OUTSIDE, button: 2 });
    expect(store.getState().dragging).toBe(false);
    fireEvent.pointerDown(grip, { pointerId: 7, ...OUTSIDE, button: 0 });
    fireEvent.pointerDown(grip, { pointerId: 8, ...OUTSIDE, button: 0 }); // second finger
    expect(document.body.querySelectorAll('.glossary-drag-ghost')).toHaveLength(1);
    fireEvent.pointerUp(grip, { pointerId: 7, ...OUTSIDE });
  });
});
