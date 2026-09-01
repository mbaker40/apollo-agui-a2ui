/**
 * Host-document keyboard shortcuts (contract §7): Escape clears the whole
 * selection list, Delete/Backspace removes the selection under the §5/§4f
 * group rules. Both are suppressed while focus sits in an editable control
 * and while the settings modal (which owns Escape) is open.
 */
import { useEffect } from 'react';
import { partitionForDelete } from '../lib/surface-doc';
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
    if (state.selectedComponentIds.length > 0) {
      store.actions.clearSelection();
    }
    return;
  }

  if (e.key === 'Delete' || e.key === 'Backspace') {
    const ids = state.selectedComponentIds;
    if (ids.length === 0) return;
    // Same partition the group delete applies (§4f): when nothing in the
    // selection is deletable (root / single-slot occupants only), stay a
    // silent no-op — matching the disabled inspector button.
    if (partitionForDelete(state.doc, ids).deletable.length === 0) return;
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
