import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RenderA2uiItem } from 'a2ui-bridge/messages';
import { Drawer } from '../src/components/Drawer';
import { emptyDoc, toRenderMessages } from '../src/lib/surface-doc';
import { StoreProvider } from '../src/state/context';
import { createComposerStore } from '../src/state/store';

function setup() {
  const sentRenders: RenderA2uiItem[][] = [];
  const store = createComposerStore();
  store.attachPort({
    sendRender: (items) => sentRenders.push(items),
    sendTheme: () => {},
    sendSetMode: () => {},
    sendSetSelection: () => {},
  });
  const view = render(
    <StoreProvider store={store}>
      <Drawer />
    </StoreProvider>,
  );
  return { store, sentRenders, view };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('JSON drawer tab', () => {
  it('shows the current doc as pretty RenderA2uiItem[] JSON', () => {
    const { store } = setup();
    const editor = screen.getByTestId('json-editor') as HTMLTextAreaElement;
    expect(editor.value).toBe(JSON.stringify(toRenderMessages(store.getState().doc), null, 2));
  });

  it('applies edited JSON to the store and re-sends RENDER_A2UI', () => {
    const { store, sentRenders } = setup();
    const editor = screen.getByTestId('json-editor') as HTMLTextAreaElement;
    const next = JSON.stringify(toRenderMessages(emptyDoc()), null, 2);
    fireEvent.change(editor, { target: { value: next } });
    expect(screen.getByTestId('json-modified')).toBeTruthy();
    fireEvent.click(screen.getByTestId('json-apply'));
    expect(store.getState().doc).toEqual(emptyDoc());
    expect(sentRenders).toHaveLength(1);
    expect(screen.queryByTestId('json-modified')).toBeNull();
    expect(screen.queryByTestId('json-error')).toBeNull();
  });

  it('shows an inline error for invalid JSON and leaves the doc untouched', () => {
    const { store, sentRenders } = setup();
    const before = store.getState().doc;
    const editor = screen.getByTestId('json-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '{"not": "an array"}' } });
    fireEvent.click(screen.getByTestId('json-apply'));
    expect(screen.getByTestId('json-error').textContent).toMatch(/array/);
    expect(store.getState().doc).toBe(before);
    expect(sentRenders).toHaveLength(0);
    // still dirty: the user's broken text is preserved for fixing
    expect(editor.value).toBe('{"not": "an array"}');
    expect(screen.getByTestId('json-modified')).toBeTruthy();
  });

  it('Format pretty-prints valid JSON in place without applying', () => {
    const { store, sentRenders } = setup();
    const editor = screen.getByTestId('json-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: '[{"version":"v0.9"}]' } });
    fireEvent.click(screen.getByTestId('json-format'));
    expect(editor.value).toBe('[\n  {\n    "version": "v0.9"\n  }\n]');
    expect(sentRenders).toHaveLength(0);
    expect(store.getState().docRevision).toBe(0);
  });

  it('Reset restores the doc JSON and clears the modified badge', () => {
    const { store } = setup();
    const editor = screen.getByTestId('json-editor') as HTMLTextAreaElement;
    fireEvent.change(editor, { target: { value: 'garbage' } });
    fireEvent.click(screen.getByTestId('json-reset'));
    expect(editor.value).toBe(JSON.stringify(toRenderMessages(store.getState().doc), null, 2));
    expect(screen.queryByTestId('json-modified')).toBeNull();
  });

  it('a pristine editor follows external doc changes; a dirty one holds', () => {
    const { store } = setup();
    const editor = screen.getByTestId('json-editor') as HTMLTextAreaElement;
    act(() => store.actions.clearCanvas());
    expect(editor.value).toBe(JSON.stringify(toRenderMessages(emptyDoc()), null, 2));
    fireEvent.change(editor, { target: { value: 'my edits' } });
    act(() => store.actions.clearCanvas());
    expect(editor.value).toBe('my edits');
    expect(screen.getByTestId('json-modified')).toBeTruthy();
  });
});

describe('Data model and Events tabs', () => {
  it('shows the doc data model until a DATA_MODEL_CHANGE snapshot arrives', () => {
    const { store } = setup();
    fireEvent.click(screen.getByRole('tab', { name: 'Data model' }));
    expect(screen.getByTestId('data-view').textContent).toBe('{}');
    act(() =>
      store.actions.bridgeDataModel({
        updateDataModel: { surfaceId: 'composer-canvas', value: { typed: 'hi' } },
      }),
    );
    expect(screen.getByTestId('data-view').textContent).toContain('"typed": "hi"');
  });

  it('lists events newest-first with console level styling', () => {
    const { store } = setup();
    act(() => {
      store.actions.logEvent('lifecycle', 'first');
      store.actions.bridgeConsole({ level: 'error', message: 'boom' });
    });
    fireEvent.click(screen.getByRole('tab', { name: 'Events' }));
    const rows = screen.getByTestId('event-list').querySelectorAll('.event-row');
    expect(rows).toHaveLength(2);
    expect(rows[0]!.textContent).toContain('boom');
    expect(rows[0]!.className).toContain('lvl-error');
    expect(rows[1]!.textContent).toContain('first');
  });
});
