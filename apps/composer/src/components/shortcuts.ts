/**
 * Host-document keyboard shortcuts (contract §7): Escape deselects,
 * Delete/Backspace removes the selection under the §5 rules. Both are
 * suppressed while focus sits in an editable control and while the settings
 * modal (which owns Escape) is open.
 */
import { useEffect } from 'react';
import { ROOT_ID, singleSlotParentOf } from '../lib/surface-doc';
import type { ComposerStore } from '../state/store';

export function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
  return target.isContentEditable === true;
}

export function handleShortcutKey(store: ComposerStore, e: KeyboardEvent): void {
  if (isEditableTarget(e.target)) return;
  const state = store.getState();
  if (state.settingsOpen) return;

  if (e.key === 'Escape') {
    if (state.selectedComponentId !== null) {
      store.actions.selectComponent(null);
    }
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const id = state.selectedComponentId;
    if (id === null || id === ROOT_ID) return;
    if (singleSlotParentOf(state.doc, id) !== null) return; // §5: slot occupant
    e.preventDefault();
    store.actions.deleteSelected();
  }
}

export function useGlobalShortcuts(store: ComposerStore): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => handleShortcutKey(store, e);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);
}
