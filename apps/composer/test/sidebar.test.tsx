import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { RightSidebar } from '../src/components/RightSidebar';
import {
  handleShortcutKey,
  isEditableTarget,
  useGlobalShortcuts,
} from '../src/components/shortcuts';
import { StoreProvider } from '../src/state/context';
import type { ComposerStore } from '../src/state/store';
import { createComposerStore } from '../src/state/store';

function makeStore() {
  const store = createComposerStore();
  store.attachPort({
    sendRender: () => {},
    sendTheme: () => {},
    sendSetMode: () => {},
    sendSetSelection: () => {},
  });
  return store;
}

function renderSidebar() {
  const store = makeStore();
  render(
    <StoreProvider store={store}>
      <RightSidebar />
    </StoreProvider>,
  );
  return store;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

function tabSelected(testId: string): boolean {
  return screen.getByTestId(testId).getAttribute('aria-selected') === 'true';
}

describe('RightSidebar Design/Chat tabs', () => {
  it('defaults to Design with the inspector visible and the chat hidden', () => {
    renderSidebar();
    expect(tabSelected('tab-design')).toBe(true);
    expect(tabSelected('tab-chat')).toBe(false);
    expect(screen.getByTestId('inspector')).toBeTruthy();
    const chatBody = screen.getByLabelText('Chat').closest('.sidebar-body');
    expect((chatBody as HTMLElement).hidden).toBe(true);
  });

  it('manual tab clicks switch panels and stick', () => {
    renderSidebar();
    fireEvent.click(screen.getByTestId('tab-chat'));
    expect(tabSelected('tab-chat')).toBe(true);
    const designBody = screen.getByTestId('inspector').closest('.sidebar-body');
    expect((designBody as HTMLElement).hidden).toBe(true);
    // chat panel (with its transcript state) stays mounted either way
    expect(screen.getByLabelText('Chat message')).toBeTruthy();
  });

  it('selecting a component auto-switches to Design until the next manual click', () => {
    const store = renderSidebar();
    fireEvent.click(screen.getByTestId('tab-chat'));
    act(() => store.actions.selectComponent('welcome-card'));
    expect(tabSelected('tab-design')).toBe(true);
    // the inspector now shows the selection
    expect(screen.getByTestId('inspector').textContent).toContain('#welcome-card');
    // manual click back to chat sticks through a deselect
    fireEvent.click(screen.getByTestId('tab-chat'));
    act(() => store.actions.selectComponent(null));
    expect(tabSelected('tab-chat')).toBe(true);
    // ... but the next selection switches again
    act(() => store.actions.selectComponent('welcome-title'));
    expect(tabSelected('tab-design')).toBe(true);
  });
});

describe('keyboard shortcuts', () => {
  function keyEvent(key: string, target?: EventTarget): KeyboardEvent {
    return {
      key,
      target: target ?? document.createElement('div'),
      preventDefault: vi.fn(),
    } as unknown as KeyboardEvent;
  }

  it('isEditableTarget guards inputs, textareas, selects, and contenteditable', () => {
    expect(isEditableTarget(document.createElement('input'))).toBe(true);
    expect(isEditableTarget(document.createElement('textarea'))).toBe(true);
    expect(isEditableTarget(document.createElement('select'))).toBe(true);
    expect(isEditableTarget(document.createElement('div'))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it('Escape deselects unless focus is editable or settings are open', () => {
    const store = makeStore();
    store.actions.selectComponent('welcome-card');
    handleShortcutKey(store, keyEvent('Escape', document.createElement('input')));
    expect(store.getState().selectedComponentId).toBe('welcome-card');
    store.actions.setSettingsOpen(true);
    handleShortcutKey(store, keyEvent('Escape'));
    expect(store.getState().selectedComponentId).toBe('welcome-card');
    store.actions.setSettingsOpen(false);
    handleShortcutKey(store, keyEvent('Escape'));
    expect(store.getState().selectedComponentId).toBeNull();
  });

  it('Delete/Backspace remove the selection only when the §5 rules allow it', () => {
    const store = makeStore();
    // nothing selected → no-op
    handleShortcutKey(store, keyEvent('Delete'));
    expect(store.getState().undoStack).toHaveLength(0);
    // root → refused silently
    store.actions.selectComponent('root');
    handleShortcutKey(store, keyEvent('Delete'));
    expect(store.getState().undoStack).toHaveLength(0);
    // single-slot occupant (Card child) → refused silently
    store.actions.selectComponent('welcome-body');
    handleShortcutKey(store, keyEvent('Backspace'));
    expect(store.getState().doc.components.some((c) => c.id === 'welcome-body')).toBe(true);
    // eligible component → removed (either key)
    store.actions.selectComponent('welcome-card');
    const e = keyEvent('Backspace');
    handleShortcutKey(store, e);
    expect(e.preventDefault).toHaveBeenCalled();
    expect(store.getState().doc.components.map((c) => c.id)).toEqual(['root']);
    expect(store.getState().selectedComponentId).toBeNull();
    // focus in a textarea → untouched doc
    store.actions.undo();
    store.actions.selectComponent('welcome-card');
    handleShortcutKey(store, keyEvent('Delete', document.createElement('textarea')));
    expect(store.getState().doc.components.some((c) => c.id === 'welcome-card')).toBe(true);
  });

  it('useGlobalShortcuts wires window keydown to the handler', () => {
    const store = makeStore();
    function Harness({ s }: { s: ComposerStore }) {
      useGlobalShortcuts(s);
      return null;
    }
    const view = render(<Harness s={store} />);
    act(() => store.actions.selectComponent('welcome-card'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(store.getState().selectedComponentId).toBeNull();
    view.unmount();
    act(() => store.actions.selectComponent('welcome-card'));
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(store.getState().selectedComponentId).toBe('welcome-card'); // listener removed
  });
});
