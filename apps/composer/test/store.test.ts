import { beforeEach, describe, expect, it } from 'vitest';
import type { RenderA2uiItem } from 'a2ui-bridge/messages';
import type { Theme } from '../src/lib/settings';
import { SURFACE_ID, emptyDoc, toRenderMessages } from '../src/lib/surface-doc';
import { EVENT_LOG_LIMIT, UNDO_LIMIT, createComposerStore } from '../src/state/store';

const TEXT_USAGE = { usage: [{ id: 'root', component: 'Text', text: 'hello' }] };

function makeStore() {
  const sentRenders: RenderA2uiItem[][] = [];
  const sentThemes: Theme[] = [];
  const sentModes: string[] = [];
  const sentSelections: (string | null)[] = [];
  const store = createComposerStore();
  store.attachPort({
    sendRender: (items) => sentRenders.push(items),
    sendTheme: (theme) => sentThemes.push(theme),
    sendSetMode: ({ mode }) => sentModes.push(mode),
    sendSetSelection: ({ id }) => sentSelections.push(id),
  });
  return { store, sentRenders, sentThemes, sentModes, sentSelections };
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

  it('clears the selection when its component disappears from the doc', () => {
    const { store } = makeStore();
    store.actions.bridgeUsages({
      Column: { usage: [{ id: 'root', component: 'Column', children: [] }] },
    });
    store.actions.insertComponent('Column');
    store.actions.selectComponent('root-g1');
    expect(store.getState().selectedComponentId).toBe('root-g1');
    store.actions.clearCanvas();
    expect(store.getState().selectedComponentId).toBeNull();
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

describe('selection', () => {
  it('selectComponent validates the id, updates state, and sends SET_SELECTION', () => {
    const { store, sentSelections } = makeStore();
    store.actions.selectComponent('welcome-card');
    expect(store.getState().selectedComponentId).toBe('welcome-card');
    expect(sentSelections).toEqual(['welcome-card']);
    store.actions.selectComponent(null);
    expect(store.getState().selectedComponentId).toBeNull();
    expect(sentSelections).toEqual(['welcome-card', null]);
  });

  it('ignores ids that are not in the doc (race with a re-render)', () => {
    const { store, sentSelections } = makeStore();
    store.actions.selectComponent('welcome-card');
    store.actions.selectComponent('no-such-id');
    expect(store.getState().selectedComponentId).toBe('welcome-card');
    expect(sentSelections).toEqual(['welcome-card']);
  });

  it('clears stale selection (and tells the catalog) after every doc-changing action', () => {
    const { store, sentSelections } = makeStore();
    // clearCanvas
    store.actions.selectComponent('welcome-card');
    store.actions.clearCanvas();
    expect(store.getState().selectedComponentId).toBeNull();
    expect(sentSelections).toEqual(['welcome-card', null]);
    // undo brings the id back but the selection stays cleared
    store.actions.undo();
    expect(store.getState().selectedComponentId).toBeNull();
    // JSON apply that drops the id
    store.actions.selectComponent('welcome-card');
    const ok = store.actions.applyJsonText(JSON.stringify(toRenderMessages(emptyDoc())));
    expect(ok.ok).toBe(true);
    expect(store.getState().selectedComponentId).toBeNull();
    // chat apply that keeps root only
    store.actions.undo();
    store.actions.selectComponent('welcome-card');
    store.actions.applyChatItems(toRenderMessages(emptyDoc()));
    expect(store.getState().selectedComponentId).toBeNull();
    // redo/undo across a selection that survives: root always exists
    store.actions.selectComponent('root');
    store.actions.undo();
    expect(store.getState().selectedComponentId).toBe('root');
  });

  it('bridgeSelect selects in edit mode and is ignored in preview mode', () => {
    const { store, sentSelections } = makeStore();
    store.actions.bridgeSelect({ id: 'welcome-card' });
    expect(store.getState().selectedComponentId).toBe('welcome-card');
    expect(sentSelections).toEqual(['welcome-card']); // answered with SET_SELECTION
    store.actions.setMode('preview');
    store.actions.bridgeSelect({ id: null });
    store.actions.bridgeSelect({ id: 'welcome-title' });
    expect(store.getState().selectedComponentId).toBe('welcome-card'); // retained
    expect(sentSelections).toEqual(['welcome-card']);
    store.actions.setMode('edit');
    store.actions.bridgeSelect({ id: null }); // background click deselects
    expect(store.getState().selectedComponentId).toBeNull();
  });

  it('selecting auto-switches the right sidebar to Design; manual clicks stick', () => {
    const { store } = makeStore();
    expect(store.getState().rightTab).toBe('design');
    store.actions.setRightTab('chat');
    expect(store.getState().rightTab).toBe('chat');
    store.actions.selectComponent('welcome-card');
    expect(store.getState().rightTab).toBe('design');
    store.actions.setRightTab('chat');
    store.actions.selectComponent(null); // deselect does not steal the tab
    expect(store.getState().rightTab).toBe('chat');
    store.actions.selectComponent('welcome-title'); // next selection switches again
    expect(store.getState().rightTab).toBe('design');
  });
});

describe('mode', () => {
  it('defaults to edit and sends COMPOSERX_SET_MODE on change (no duplicates)', () => {
    const { store, sentModes } = makeStore();
    expect(store.getState().mode).toBe('edit');
    store.actions.setMode('preview');
    expect(store.getState().mode).toBe('preview');
    store.actions.setMode('preview'); // no-op
    store.actions.setMode('edit');
    expect(sentModes).toEqual(['preview', 'edit']);
  });
});

describe('prop editing', () => {
  it('commitProp is one undo step and re-renders', () => {
    const { store, sentRenders } = makeStore();
    const result = store.actions.commitProp('welcome-title', 'text', 'Hello!');
    expect(result.ok).toBe(true);
    expect(store.getState().doc.components.find((c) => c.id === 'welcome-title')!.text).toBe(
      'Hello!',
    );
    expect(store.getState().undoStack).toHaveLength(1);
    expect(sentRenders).toHaveLength(1);
    store.actions.undo();
    expect(store.getState().doc.components.find((c) => c.id === 'welcome-title')!.text).toBe(
      'A2UI Composer',
    );
  });

  it('commitProp surfaces op errors without crashing or mutating', () => {
    const { store, sentRenders } = makeStore();
    const before = store.getState().doc;
    const guarded = store.actions.commitProp('welcome-title', 'children', []);
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) expect(guarded.error).toMatch(/cannot be edited directly/);
    const unknown = store.actions.commitProp('nope', 'text', 'x');
    expect(unknown.ok).toBe(false);
    expect(store.getState().doc).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(sentRenders).toHaveLength(0);
    expect(store.getState().events.some((e) => e.kind === 'error')).toBe(true);
  });

  it('removeProp removes the key as one undo step', () => {
    const { store } = makeStore();
    const result = store.actions.removeProp('welcome-title', 'variant');
    expect(result.ok).toBe(true);
    expect(
      'variant' in store.getState().doc.components.find((c) => c.id === 'welcome-title')!,
    ).toBe(false);
    expect(store.getState().undoStack).toHaveLength(1);
    store.actions.undo();
    expect(store.getState().doc.components.find((c) => c.id === 'welcome-title')!.variant).toBe(
      'h2',
    );
  });
});

describe('deleteSelected', () => {
  it('removes the selected subtree, clears the selection, and is undo-able', () => {
    const { store, sentSelections } = makeStore();
    store.actions.selectComponent('welcome-card');
    const result = store.actions.deleteSelected();
    expect(result.ok).toBe(true);
    const doc = store.getState().doc;
    // Card + its Column body + all body children are gone
    expect(doc.components.map((c) => c.id)).toEqual(['root']);
    expect(store.getState().selectedComponentId).toBeNull();
    expect(sentSelections).toEqual(['welcome-card', null]);
    expect(store.getState().undoStack).toHaveLength(1);
    store.actions.undo();
    expect(store.getState().doc.components.some((c) => c.id === 'welcome-card')).toBe(true);
  });

  it('reports when nothing is selected and refuses single-slot occupants', () => {
    const { store } = makeStore();
    expect(store.actions.deleteSelected().ok).toBe(false);
    const before = store.getState().doc;
    store.actions.selectComponent('welcome-body'); // Card child slot occupant
    const refused = store.actions.deleteSelected();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/single slot/);
    expect(store.getState().doc).toBe(before);
    expect(store.getState().selectedComponentId).toBe('welcome-body');
    store.actions.selectComponent('root');
    expect(store.actions.deleteSelected().ok).toBe(false);
  });
});

describe('sidecar v2 payloads', () => {
  it('parses SIDECAR_READY features (v2 and v1)', () => {
    const { store } = makeStore();
    store.actions.bridgeSidecarReady({
      features: ['dnd-hittest', 'select', 'prop-specs'],
      version: 2,
    });
    expect(store.getState().handshake.sidecar).toBe(true);
    expect(store.getState().handshake.sidecarFeatures).toEqual([
      'dnd-hittest',
      'select',
      'prop-specs',
    ]);
    store.actions.handshakeReset();
    store.actions.bridgeSidecarReady({ features: ['dnd-hittest'], version: 1 });
    expect(store.getState().handshake.sidecarFeatures).toEqual(['dnd-hittest']);
  });

  it('stores PROP_SPECS, ignores malformed payloads, resets with the handshake', () => {
    const { store } = makeStore();
    expect(store.getState().propSpecs).toBeNull();
    store.actions.bridgePropSpecs({
      components: { Text: { props: [{ name: 'text', kind: 'string', required: true }] } },
    });
    expect(store.getState().propSpecs?.Text?.props[0]?.name).toBe('text');
    store.actions.bridgePropSpecs({ components: null } as never);
    expect(store.getState().propSpecs?.Text).toBeTruthy(); // kept, malformed ignored
    store.actions.handshakeReset();
    expect(store.getState().propSpecs).toBeNull();
  });
});
