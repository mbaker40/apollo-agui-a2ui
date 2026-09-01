/**
 * Mobile store behavior (contract §7b): mobileView transitions, the insert
 * toast lifecycle, drawer default, and the shared insertFromDrag path used
 * by both the HTML5 drop overlay and the pointer grip drag.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RenderA2uiItem } from 'a2ui-bridge/messages';
import { TOAST_DURATION_MS, createComposerStore } from '../src/state/store';

const USAGES = {
  Text: { usage: [{ id: 'root', component: 'Text', text: 'hi' }] },
  Column: { usage: [{ id: 'root', component: 'Column', children: [] }] },
};

function makeStore(mobile: boolean) {
  const sentRenders: RenderA2uiItem[][] = [];
  const store = createComposerStore({ mobile });
  store.attachPort({
    sendRender: (items) => sentRenders.push(items),
    sendTheme: () => {},
    sendSetMode: () => {},
    sendSetSelection: () => {},
  });
  return { store, sentRenders };
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('mobile store defaults', () => {
  it('starts with the drawer closed on mobile and open on desktop', () => {
    expect(makeStore(true).store.getState().drawerOpen).toBe(false);
    expect(makeStore(false).store.getState().drawerOpen).toBe(true);
  });

  it('defaults to the canvas view with no toast', () => {
    const { store } = makeStore(true);
    expect(store.getState().mobileView).toBe('canvas');
    expect(store.getState().toast).toBeNull();
  });
});

describe('mobileView transitions', () => {
  it('tile insert on mobile switches back to the canvas view and toasts what landed where', () => {
    const { store } = makeStore(true);
    store.actions.bridgeUsages(USAGES);
    store.actions.setMobileView('add');
    const result = store.actions.insertComponent('Text', { containerId: 'welcome-body' });
    expect(result.ok).toBe(true);
    expect(store.getState().mobileView).toBe('canvas');
    expect(store.getState().toast?.message).toBe('Text → #welcome-body');
  });

  it('untargeted inserts toast the root container (insertUsage default)', () => {
    const { store } = makeStore(true);
    store.actions.bridgeUsages(USAGES);
    store.actions.insertComponent('Text');
    expect(store.getState().toast?.message).toBe('Text → #root');
  });

  it('failed inserts neither switch the view nor toast', () => {
    const { store } = makeStore(true);
    store.actions.setMobileView('add');
    expect(store.actions.insertComponent('Text').ok).toBe(false); // usages not arrived
    expect(store.getState().mobileView).toBe('add');
    expect(store.getState().toast).toBeNull();
  });

  it('desktop inserts never toast or touch mobileView', () => {
    const { store } = makeStore(false);
    store.actions.bridgeUsages(USAGES);
    store.actions.setMobileView('add'); // desktop ignores it, but state holds it
    expect(store.actions.insertComponent('Text').ok).toBe(true);
    expect(store.getState().mobileView).toBe('add');
    expect(store.getState().toast).toBeNull();
  });

  it('selection on mobile switches to the Design view (and the sidebar tab)', () => {
    const { store } = makeStore(true);
    store.actions.selectComponent('welcome-card');
    expect(store.getState().mobileView).toBe('design');
    expect(store.getState().rightTab).toBe('design');
    // Deselecting leaves the view alone (mirror of the desktop tab rule).
    store.actions.setMobileView('canvas');
    store.actions.selectComponent(null);
    expect(store.getState().mobileView).toBe('canvas');
  });

  it('MOVE_START selects WITHOUT hiding the canvas (the §4e drag is in flight)', () => {
    const { store } = makeStore(true);
    store.actions.bridgeMoveStart({ id: 'welcome-title' });
    expect(store.getState().selectedComponentId).toBe('welcome-title');
    expect(store.getState().rightTab).toBe('design');
    expect(store.getState().mobileView).toBe('canvas');
  });

  it('desktop selection leaves mobileView untouched', () => {
    const { store } = makeStore(false);
    store.actions.selectComponent('welcome-card');
    expect(store.getState().mobileView).toBe('canvas');
    expect(store.getState().rightTab).toBe('design');
  });

  it('setMobileView syncs the right-sidebar tab for the design/chat views only', () => {
    const { store } = makeStore(true);
    store.actions.setMobileView('chat');
    expect(store.getState().rightTab).toBe('chat');
    store.actions.setMobileView('add');
    expect(store.getState().rightTab).toBe('chat'); // untouched
    store.actions.setMobileView('design');
    expect(store.getState().rightTab).toBe('design');
  });

  it('setMobile tracks breakpoint crossings', () => {
    const { store } = makeStore(false);
    store.actions.setMobile(true);
    expect(store.getState().mobile).toBe(true);
    store.actions.setMobile(false);
    expect(store.getState().mobile).toBe(false);
  });
});

describe('toast lifecycle', () => {
  it('auto-dismisses after TOAST_DURATION_MS', () => {
    const { store } = makeStore(true);
    store.actions.showToast('Button → #root');
    expect(store.getState().toast?.message).toBe('Button → #root');
    vi.advanceTimersByTime(TOAST_DURATION_MS - 100);
    expect(store.getState().toast).not.toBeNull();
    vi.advanceTimersByTime(100);
    expect(store.getState().toast).toBeNull();
  });

  it('shows one toast at a time: a new one replaces and re-arms the timer', () => {
    const { store } = makeStore(true);
    store.actions.showToast('first');
    vi.advanceTimersByTime(TOAST_DURATION_MS - 500);
    store.actions.showToast('second');
    expect(store.getState().toast?.message).toBe('second');
    vi.advanceTimersByTime(600); // past the FIRST toast's would-be expiry
    expect(store.getState().toast?.message).toBe('second');
    vi.advanceTimersByTime(TOAST_DURATION_MS);
    expect(store.getState().toast).toBeNull();
  });

  it('dismissToast clears immediately and cancels the pending timer', () => {
    const { store } = makeStore(true);
    store.actions.showToast('bye');
    store.actions.dismissToast();
    expect(store.getState().toast).toBeNull();
    vi.advanceTimersByTime(TOAST_DURATION_MS * 2); // no stale timer surprises
    expect(store.getState().toast).toBeNull();
  });
});

describe('insertFromDrag (shared drop path)', () => {
  it('prefers the held sidecar target (containerId + index)', () => {
    const { store } = makeStore(false);
    store.actions.bridgeUsages(USAGES);
    const result = store.actions.insertFromDrag('Text', {
      targetId: 'welcome-title',
      containerId: 'welcome-body',
      index: 0,
      slot: 'before',
      rect: null,
    });
    expect(result.ok).toBe(true);
    const body = store.getState().doc.components.find((c) => c.id === 'welcome-body')!;
    expect((body.children as string[])[0]).toBe('root-g1');
  });

  it('falls back to the selection-derived container when no target is held', () => {
    const { store } = makeStore(false);
    store.actions.bridgeUsages(USAGES);
    store.actions.selectComponent('welcome-title'); // leaf → welcome-body
    expect(store.actions.insertFromDrag('Text', null).ok).toBe(true);
    const body = store.getState().doc.components.find((c) => c.id === 'welcome-body')!;
    expect(body.children).toContain('root-g1');
  });

  it('treats a null containerId in the target as a structural fallback', () => {
    const { store } = makeStore(false);
    store.actions.bridgeUsages(USAGES);
    const result = store.actions.insertFromDrag('Text', {
      targetId: null,
      containerId: null,
      index: null,
      slot: null,
      rect: null,
    });
    expect(result.ok).toBe(true);
    const root = store.getState().doc.components.find((c) => c.id === 'root')!;
    expect(root.children).toContain('root-g1');
  });
});
