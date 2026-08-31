import { beforeEach, describe, expect, it } from 'vitest';
import type { RenderA2uiItem } from 'a2ui-bridge/messages';
import type { Theme } from '../src/lib/settings';
import { SURFACE_ID, emptyDoc, toRenderMessages } from '../src/lib/surface-doc';
import { EVENT_LOG_LIMIT, UNDO_LIMIT, createComposerStore } from '../src/state/store';

const TEXT_USAGE = { usage: [{ id: 'root', component: 'Text', text: 'hello' }] };

function makeStore() {
  const sentRenders: RenderA2uiItem[][] = [];
  const sentThemes: Theme[] = [];
  const store = createComposerStore();
  store.attachPort({
    sendRender: (items) => sentRenders.push(items),
    sendTheme: (theme) => sentThemes.push(theme),
  });
  return { store, sentRenders, sentThemes };
}

beforeEach(() => {
  window.localStorage.clear();
});

describe('composer store', () => {
  it('seeds with the welcome layout', () => {
    const { store } = makeStore();
    const doc = store.getState().doc;
    expect(doc.surfaceId).toBe(SURFACE_ID);
    expect(doc.components.length).toBeGreaterThan(1);
    expect(doc.components[0]!.id).toBe('root');
  });

  it('insertComponent uses handshake usages and re-sends RENDER_A2UI', () => {
    const { store, sentRenders } = makeStore();
    expect(store.actions.insertComponent('Text').ok).toBe(false); // usages not arrived
    store.actions.bridgeUsages({ Text: TEXT_USAGE });
    const result = store.actions.insertComponent('Text');
    expect(result.ok).toBe(true);
    expect(sentRenders).toHaveLength(1);
    expect(store.getState().doc.components.some((c) => c.id === 'root-g1')).toBe(true);
    expect(sentRenders[0]).toEqual(toRenderMessages(store.getState().doc));
  });

  it('clearCanvas empties to the bare root and is undo-able', () => {
    const { store, sentRenders } = makeStore();
    store.actions.clearCanvas();
    expect(store.getState().doc).toEqual(emptyDoc());
    store.actions.undo();
    expect(store.getState().doc.components.length).toBeGreaterThan(1);
    store.actions.redo();
    expect(store.getState().doc).toEqual(emptyDoc());
    expect(sentRenders).toHaveLength(3); // clear + undo + redo each re-send
  });

  it('applyJsonText applies valid payloads and reports parse errors without mutating', () => {
    const { store } = makeStore();
    const before = store.getState().doc;
    const bad = store.actions.applyJsonText('{ not json');
    expect(bad.ok).toBe(false);
    expect(store.getState().doc).toBe(before);
    const invalid = store.actions.applyJsonText('{"a": 1}');
    expect(invalid.ok).toBe(false);
    if (!invalid.ok) expect(invalid.error).toMatch(/array/);
    const good = store.actions.applyJsonText(JSON.stringify(toRenderMessages(emptyDoc())));
    expect(good.ok).toBe(true);
    expect(store.getState().doc).toEqual(emptyDoc());
  });

  it('bounds the undo stack at 50 snapshots', () => {
    const { store } = makeStore();
    store.actions.bridgeUsages({ Text: TEXT_USAGE });
    for (let i = 0; i < UNDO_LIMIT + 10; i++) {
      expect(store.actions.insertComponent('Text').ok).toBe(true);
    }
    expect(store.getState().undoStack).toHaveLength(UNDO_LIMIT);
  });

  it('resets the selected container when it disappears from the doc', () => {
    const { store } = makeStore();
    store.actions.bridgeUsages({
      Column: { usage: [{ id: 'root', component: 'Column', children: [] }] },
    });
    store.actions.insertComponent('Column');
    store.actions.selectContainer('root-g1');
    expect(store.getState().selectedContainerId).toBe('root-g1');
    store.actions.clearCanvas();
    expect(store.getState().selectedContainerId).toBe('root');
  });

  it('caps the event log at 200 newest-first entries', () => {
    const { store } = makeStore();
    for (let i = 0; i < EVENT_LOG_LIMIT + 25; i++) {
      store.actions.logEvent('lifecycle', `event ${i}`);
    }
    const events = store.getState().events;
    expect(events).toHaveLength(EVENT_LOG_LIMIT);
    expect(events[0]!.summary).toBe(`event ${EVENT_LOG_LIMIT + 24}`);
  });

  it('setTheme persists, updates <html data-theme>, and notifies the port', () => {
    const { store, sentThemes } = makeStore();
    store.actions.setTheme('dark');
    expect(window.localStorage.getItem('composerx.theme')).toBe('dark');
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(sentThemes).toEqual(['dark']);
  });

  it('setRendererUrl persists and reset falls back to the default chain', () => {
    const { store } = makeStore();
    store.actions.setRendererUrl('http://example.test:9000/renderer/');
    expect(store.getState().settings.rendererUrl).toBe('http://example.test:9000/renderer/');
    expect(window.localStorage.getItem('composerx.rendererUrl')).toBe(
      'http://example.test:9000/renderer/',
    );
    store.actions.setRendererUrl(null);
    expect(window.localStorage.getItem('composerx.rendererUrl')).toBeNull();
    expect(store.getState().settings.rendererUrl).not.toBe('http://example.test:9000/renderer/');
  });

  it('tracks handshake data and DATA_MODEL_CHANGE snapshots', () => {
    const { store } = makeStore();
    store.actions.bridgeReady();
    store.actions.bridgeCatalog({ title: 'Basic Catalog', components: {} });
    store.actions.bridgeSidecarReady({ features: ['dnd-hittest'], version: 1 });
    store.actions.bridgeDataModel({
      updateDataModel: { surfaceId: SURFACE_ID, value: { typed: 'yes' } },
    });
    const s = store.getState();
    expect(s.handshake.ready).toBe(true);
    expect(s.handshake.sidecar).toBe(true);
    expect(s.handshake.catalog?.title).toBe('Basic Catalog');
    expect(s.rendererDataModel).toEqual({ typed: 'yes' });
    store.actions.handshakeReset();
    expect(store.getState().handshake.ready).toBe(false);
    expect(store.getState().rendererDataModel).toBeNull();
  });

  it('timeout only marks timed-out while not ready', () => {
    const { store } = makeStore();
    store.actions.handshakeTimedOut();
    expect(store.getState().handshake.timedOut).toBe(true);
    store.actions.bridgeReady();
    expect(store.getState().handshake.timedOut).toBe(false);
    store.actions.handshakeTimedOut();
    expect(store.getState().handshake.timedOut).toBe(false);
  });
});
