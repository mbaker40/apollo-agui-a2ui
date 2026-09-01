import { beforeEach, describe, expect, it } from 'vitest';
import type { RenderA2uiItem } from 'a2ui-bridge/messages';
import type { SetSelectionPayload } from '../src/lib/bridge-host';
import type { Theme } from '../src/lib/settings';
import type { SurfaceDoc } from '../src/lib/surface-doc';
import { CATALOG_ID, SURFACE_ID, emptyDoc, toRenderMessages } from '../src/lib/surface-doc';
import type { ComposerStoreOptions } from '../src/state/store';
import { EVENT_LOG_LIMIT, UNDO_LIMIT, createComposerStore } from '../src/state/store';

const TEXT_USAGE = { usage: [{ id: 'root', component: 'Text', text: 'hello' }] };

function makeStore(options: ComposerStoreOptions = {}) {
  const sentRenders: RenderA2uiItem[][] = [];
  const sentThemes: Theme[] = [];
  const sentModes: string[] = [];
  const sentSelections: (string | null)[] = [];
  // Full §4f payloads ({id: primary, ids: list}); sentSelections keeps the
  // primary-only view the single-selection assertions were written against.
  const sentSelectionPayloads: SetSelectionPayload[] = [];
  const store = createComposerStore(options);
  store.attachPort({
    sendRender: (items) => sentRenders.push(items),
    sendTheme: (theme) => sentThemes.push(theme),
    sendSetMode: ({ mode }) => sentModes.push(mode),
    sendSetSelection: (payload) => {
      sentSelections.push(payload.id);
      sentSelectionPayloads.push(structuredClone(payload));
    },
  });
  return { store, sentRenders, sentThemes, sentModes, sentSelections, sentSelectionPayloads };
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

describe('moveComponentTo', () => {
  // welcome doc: root Column [welcome-card(Card → welcome-body Column
  // [welcome-title, welcome-text, welcome-cta])]
  function bodyChildren(store: ReturnType<typeof makeStore>['store']) {
    return store.getState().doc.components.find((c) => c.id === 'welcome-body')!.children;
  }

  it('applies a valid move as ONE undo snapshot + re-render + event-log entry', () => {
    const { store, sentRenders } = makeStore();
    // reorder within welcome-body: title (index 0) to the end (after-removal index 2)
    const result = store.actions.moveComponentTo('welcome-title', 'welcome-body', 2);
    expect(result.ok).toBe(true);
    expect(bodyChildren(store)).toEqual(['welcome-text', 'welcome-cta', 'welcome-title']);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(sentRenders).toHaveLength(1);
    expect(store.getState().events.some((e) => e.summary.includes('move welcome-title'))).toBe(
      true,
    );
    store.actions.undo();
    expect(bodyChildren(store)).toEqual(['welcome-title', 'welcome-text', 'welcome-cta']);
  });

  it('moves across containers, subtree intact', () => {
    const { store } = makeStore();
    const result = store.actions.moveComponentTo('welcome-cta', 'root', 0);
    expect(result.ok).toBe(true);
    const doc = store.getState().doc;
    expect(doc.components.find((c) => c.id === 'root')!.children).toEqual([
      'welcome-cta',
      'welcome-card',
    ]);
    expect(bodyChildren(store)).toEqual(['welcome-title', 'welcome-text']);
    // the Button kept its label child — no remap, subtree traveled
    expect(doc.components.find((c) => c.id === 'welcome-cta')!.child).toBe('welcome-cta-label');
  });

  it('surfaces canMoveTo refusals without throwing: doc unchanged, reason logged', () => {
    const { store, sentRenders } = makeStore();
    const before = store.getState().doc;
    const slot = store.actions.moveComponentTo('welcome-body', 'root', 0);
    expect(slot.ok).toBe(false);
    if (!slot.ok) expect(slot.error).toMatch(/single slot/);
    const subtree = store.actions.moveComponentTo('welcome-card', 'welcome-body', 0);
    expect(subtree.ok).toBe(false);
    if (!subtree.ok) expect(subtree.error).toMatch(/own subtree/);
    const unknown = store.actions.moveComponentTo('ghost', 'root', 0);
    expect(unknown.ok).toBe(false);
    expect(store.getState().doc).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(sentRenders).toHaveLength(0);
    expect(
      store.getState().events.filter((e) => e.kind === 'error' && /refused/.test(e.summary)),
    ).toHaveLength(3);
  });

  it('same-position moves are no-ops: no undo snapshot, no re-render', () => {
    const { store, sentRenders } = makeStore();
    const result = store.actions.moveComponentTo('welcome-title', 'welcome-body', 0);
    expect(result.ok).toBe(true);
    expect(bodyChildren(store)).toEqual(['welcome-title', 'welcome-text', 'welcome-cta']);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(sentRenders).toHaveLength(0);
  });
});

describe('bridge MOVE_* flows (§4e)', () => {
  it('MOVE_START selects the lifted component and logs', () => {
    const { store, sentSelections } = makeStore();
    store.actions.bridgeMoveStart({ id: 'welcome-card' });
    expect(store.getState().selectedComponentId).toBe('welcome-card');
    expect(sentSelections).toEqual(['welcome-card']);
    expect(store.getState().events.some((e) => e.summary.includes('COMPOSERX_MOVE_START'))).toBe(
      true,
    );
  });

  it('MOVE_DROP applies through moveComponentTo (one undo step)', () => {
    const { store, sentRenders } = makeStore();
    store.actions.bridgeMoveDrop({
      id: 'welcome-title',
      containerId: 'welcome-body',
      index: 2,
      slot: 'after',
    });
    expect(store.getState().doc.components.find((c) => c.id === 'welcome-body')!.children).toEqual([
      'welcome-text',
      'welcome-cta',
      'welcome-title',
    ]);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(sentRenders).toHaveLength(1);
  });

  it('an invalid MOVE_DROP logs the canMoveTo reason and leaves the doc unchanged', () => {
    const { store, sentRenders } = makeStore();
    const before = store.getState().doc;
    store.actions.bridgeMoveDrop({
      id: 'welcome-card',
      containerId: 'welcome-body', // inside its own subtree
      index: 0,
      slot: 'into',
    });
    expect(store.getState().doc).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(sentRenders).toHaveLength(0);
    const err = store.getState().events.find((e) => e.kind === 'error');
    expect(err?.summary).toMatch(/own subtree/);
  });

  it('MOVE_CANCEL only logs', () => {
    const { store, sentRenders } = makeStore();
    const before = store.getState().doc;
    store.actions.bridgeMoveCancel({ id: 'welcome-card' });
    expect(store.getState().doc).toBe(before);
    expect(sentRenders).toHaveLength(0);
    expect(store.getState().selectedComponentId).toBeNull();
    expect(store.getState().events.some((e) => e.summary.includes('COMPOSERX_MOVE_CANCEL'))).toBe(
      true,
    );
  });

  it('ignores all MOVE_* messages in preview mode (belt over suspenders)', () => {
    const { store, sentRenders, sentSelections } = makeStore();
    store.actions.setMode('preview');
    const before = store.getState().doc;
    const eventsBefore = store.getState().events.length;
    store.actions.bridgeMoveStart({ id: 'welcome-card' });
    store.actions.bridgeMoveDrop({
      id: 'welcome-title',
      containerId: 'welcome-body',
      index: 2,
      slot: 'after',
    });
    store.actions.bridgeMoveCancel({ id: 'welcome-card' });
    expect(store.getState().doc).toBe(before);
    expect(store.getState().selectedComponentId).toBeNull();
    expect(sentSelections).toEqual([]);
    expect(sentRenders).toHaveLength(0);
    expect(store.getState().events.length).toBe(eventsBefore);
  });
});

describe('group move (contract §4e group move)', () => {
  // root Column [card(Card → cardBody Column [inner]), txt, txt2] — the same
  // shape the group-delete tests use.
  function groupDoc(): SurfaceDoc {
    return {
      surfaceId: SURFACE_ID,
      catalogId: CATALOG_ID,
      components: [
        { id: 'root', component: 'Column', children: ['card', 'txt', 'txt2'] },
        { id: 'card', component: 'Card', child: 'cardBody' },
        { id: 'cardBody', component: 'Column', children: ['inner'] },
        { id: 'inner', component: 'Text', text: 'inner' },
        { id: 'txt', component: 'Text', text: 'a' },
        { id: 'txt2', component: 'Text', text: 'b' },
      ],
      dataModel: {},
    };
  }
  function rootChildren(store: ReturnType<typeof makeStore>['store']) {
    return store.getState().doc.components.find((c) => c.id === 'root')!.children;
  }
  function bodyChildren(store: ReturnType<typeof makeStore>['store']) {
    return store.getState().doc.components.find((c) => c.id === 'cardBody')!.children;
  }

  it('MOVE_START with ids preserves the multi-selection (no collapse, no re-send)', () => {
    const { store, sentSelectionPayloads } = makeStore({ doc: groupDoc() });
    store.actions.setSelection(['txt', 'txt2']);
    const sends = sentSelectionPayloads.length;
    store.actions.bridgeMoveStart({ id: 'txt', ids: ['txt', 'txt2'] });
    expect(store.getState().selectedComponentIds).toEqual(['txt', 'txt2']);
    expect(store.getState().selectedComponentId).toBe('txt');
    expect(sentSelectionPayloads).toHaveLength(sends);
    expect(store.getState().events.some((e) => e.summary.includes('lifting 2 components'))).toBe(
      true,
    );
  });

  it('MOVE_START without ids still collapses to the lifted id (single path untouched)', () => {
    const { store } = makeStore({ doc: groupDoc() });
    store.actions.setSelection(['txt', 'txt2']);
    store.actions.bridgeMoveStart({ id: 'txt' });
    expect(store.getState().selectedComponentIds).toEqual(['txt']);
  });

  it('MOVE_DROP with ids applies ONE undo snapshot + one re-render, keeps the group selected', () => {
    const { store, sentRenders, sentSelectionPayloads } = makeStore({ doc: groupDoc() });
    store.actions.setSelection(['txt2', 'txt']); // selection order ≠ document order
    const sends = sentSelectionPayloads.length;
    store.actions.bridgeMoveDrop({
      id: 'txt2',
      containerId: 'cardBody',
      index: 1,
      slot: 'after',
      ids: ['txt2', 'txt'],
    });
    // contiguous run in DOCUMENT order [txt, txt2] at index 1 of [inner]
    expect(bodyChildren(store)).toEqual(['inner', 'txt', 'txt2']);
    expect(rootChildren(store)).toEqual(['card']);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(sentRenders).toHaveLength(1);
    // the moved set stays selected, primary unchanged, nothing re-sent
    expect(store.getState().selectedComponentIds).toEqual(['txt2', 'txt']);
    expect(store.getState().selectedComponentId).toBe('txt2');
    expect(sentSelectionPayloads).toHaveLength(sends);
    store.actions.undo(); // ONE step restores everything
    expect(rootChildren(store)).toEqual(['card', 'txt', 'txt2']);
    expect(bodyChildren(store)).toEqual(['inner']);
  });

  it('toasts skipped members like group delete and leaves them in place (still selected)', () => {
    const { store, sentRenders } = makeStore({ doc: groupDoc() });
    store.actions.setSelection(['cardBody', 'txt']); // cardBody fills card's child slot
    store.actions.bridgeMoveDrop({
      id: 'txt',
      containerId: 'root',
      index: 2,
      slot: 'after',
      ids: ['cardBody', 'txt'],
    });
    expect(rootChildren(store)).toEqual(['card', 'txt2', 'txt']);
    expect(store.getState().toast?.message).toBe('1 skipped — single-slot occupant (#cardBody)');
    expect(store.getState().undoStack).toHaveLength(1);
    expect(sentRenders).toHaveLength(1);
    expect(store.getState().selectedComponentIds).toEqual(['cardBody', 'txt']);
    expect(store.getState().doc.components.find((c) => c.id === 'card')!.child).toBe('cardBody');
  });

  it('refuses invalid group drops: doc + undo untouched, reason logged', () => {
    const { store, sentRenders } = makeStore({ doc: groupDoc() });
    const before = store.getState().doc;
    // target inside a moved subtree
    store.actions.bridgeMoveDrop({
      id: 'card',
      containerId: 'cardBody',
      index: 0,
      slot: 'into',
      ids: ['card', 'txt'],
    });
    // empty effective set: only a single-slot occupant
    store.actions.bridgeMoveDrop({
      id: 'cardBody',
      containerId: 'root',
      index: 0,
      slot: 'into',
      ids: ['cardBody'],
    });
    // empty effective set: stale ids only
    store.actions.bridgeMoveDrop({
      id: 'ghost',
      containerId: 'root',
      index: 0,
      slot: 'into',
      ids: ['ghost', 'ghost2'],
    });
    expect(store.getState().doc).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(sentRenders).toHaveLength(0);
    const errors = store
      .getState()
      .events.filter((e) => e.kind === 'error' && /Group move refused/.test(e.summary));
    expect(errors).toHaveLength(3);
    expect(errors.some((e) => /own subtree/.test(e.summary))).toBe(true);
    expect(errors.some((e) => /nothing movable/.test(e.summary))).toBe(true);
  });

  it('a same-position group drop is a no-op: no undo snapshot, no re-render', () => {
    const { store, sentRenders } = makeStore({ doc: groupDoc() });
    // txt/txt2 already sit at root[1..2]; dropping them back there changes nothing.
    store.actions.bridgeMoveDrop({
      id: 'txt',
      containerId: 'root',
      index: 1,
      slot: 'after',
      ids: ['txt', 'txt2'],
    });
    expect(rootChildren(store)).toEqual(['card', 'txt', 'txt2']);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(sentRenders).toHaveLength(0);
  });

  it('MOVE_DROP with empty ids falls back to the single-move path', () => {
    const { store } = makeStore({ doc: groupDoc() });
    store.actions.bridgeMoveDrop({
      id: 'txt',
      containerId: 'root',
      index: 2,
      slot: 'after',
      ids: [],
    });
    expect(rootChildren(store)).toEqual(['card', 'txt2', 'txt']);
    expect(store.getState().undoStack).toHaveLength(1);
  });

  it('ignores group MOVE_* messages in preview mode too', () => {
    const { store, sentRenders } = makeStore({ doc: groupDoc() });
    store.actions.setSelection(['txt', 'txt2']);
    store.actions.setMode('preview');
    const before = store.getState().doc;
    store.actions.bridgeMoveStart({ id: 'txt', ids: ['txt', 'txt2'] });
    store.actions.bridgeMoveDrop({
      id: 'txt',
      containerId: 'cardBody',
      index: 1,
      slot: 'into',
      ids: ['txt', 'txt2'],
    });
    expect(store.getState().doc).toBe(before);
    expect(sentRenders).toHaveLength(0);
    expect(store.getState().selectedComponentIds).toEqual(['txt', 'txt2']);
  });

  it('moveComponentsTo is directly callable (tree path) with the same semantics', () => {
    const { store, sentRenders } = makeStore({ doc: groupDoc() });
    const result = store.actions.moveComponentsTo(['txt2', 'txt'], 'cardBody', 0);
    expect(result.ok).toBe(true);
    expect(bodyChildren(store)).toEqual(['txt', 'txt2', 'inner']);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(sentRenders).toHaveLength(1);
    const refused = store.actions.moveComponentsTo(['ghost'], 'root', 0);
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/nothing movable/);
    expect(store.getState().undoStack).toHaveLength(1); // unchanged
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

describe('repeat-tap ancestor cycling (contract §7 ancestor honing)', () => {
  // welcome doc chain from the CTA label:
  // welcome-cta-label → welcome-cta → welcome-body → welcome-card → root
  const CHAIN = ['welcome-cta-label', 'welcome-cta', 'welcome-body', 'welcome-card', 'root'];

  it('same-spot taps walk the inclusive chain up and wrap to the deepest', () => {
    const { store } = makeStore();
    for (const expected of CHAIN) {
      store.actions.bridgeSelect({ id: 'welcome-cta-label' });
      expect(store.getState().selectedComponentId).toBe(expected);
    }
    // Past root wraps back to the deepest hit.
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    expect(store.getState().selectedComponentId).toBe('welcome-cta-label');
  });

  it('each cycled step re-sends SET_SELECTION so the outline moves', () => {
    const { store, sentSelections } = makeStore();
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    expect(sentSelections.slice(-3)).toEqual(['welcome-cta-label', 'welcome-cta', 'welcome-body']);
  });

  it('a different hit id resets to a fresh deepest select', () => {
    const { store } = makeStore();
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    store.actions.bridgeSelect({ id: 'welcome-cta-label' }); // welcome-cta
    store.actions.bridgeSelect({ id: 'welcome-title' });
    expect(store.getState().selectedComponentId).toBe('welcome-title');
    // And the new spot starts its own cycle.
    store.actions.bridgeSelect({ id: 'welcome-title' });
    expect(store.getState().selectedComponentId).toBe('welcome-body');
  });

  it('a background tap deselects and resets the cycle', () => {
    const { store } = makeStore();
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    store.actions.bridgeSelect({ id: null });
    expect(store.getState().selectedComponentId).toBeNull();
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    expect(store.getState().selectedComponentId).toBe('welcome-cta-label'); // fresh, not cycled
  });

  it('a selection made elsewhere (tree/breadcrumb) outside the chain makes the next tap fresh', () => {
    const { store } = makeStore();
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    store.actions.selectComponent('welcome-title'); // tree click, not in the label's chain
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    expect(store.getState().selectedComponentId).toBe('welcome-cta-label');
  });

  it('a selection made elsewhere INSIDE the chain continues cycling from there', () => {
    const { store } = makeStore();
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    store.actions.selectComponent('welcome-body'); // breadcrumb jump into the chain
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    expect(store.getState().selectedComponentId).toBe('welcome-card');
  });

  it('doc changes that remove the hit id reset the cycle', () => {
    const { store } = makeStore();
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    store.actions.clearCanvas(); // welcome ids gone
    store.actions.undo(); // ids are back, but the cycle must not resume
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    expect(store.getState().selectedComponentId).toBe('welcome-cta-label');
  });

  it('preview mode still ignores SELECT entirely', () => {
    const { store } = makeStore();
    store.actions.setMode('preview');
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    expect(store.getState().selectedComponentId).toBeNull();
  });
});

describe('multi-select (contract §4f)', () => {
  function ids(store: ReturnType<typeof makeStore>['store']) {
    return store.getState().selectedComponentIds;
  }
  function primary(store: ReturnType<typeof makeStore>['store']) {
    return store.getState().selectedComponentId;
  }

  it('toggleSelected adds at the end, removes, and promotes the next primary', () => {
    const { store, sentSelectionPayloads } = makeStore();
    store.actions.toggleSelected('welcome-title');
    expect(ids(store)).toEqual(['welcome-title']);
    expect(primary(store)).toBe('welcome-title');

    store.actions.toggleSelected('welcome-text');
    expect(ids(store)).toEqual(['welcome-title', 'welcome-text']);
    expect(primary(store)).toBe('welcome-title'); // primary stays the first

    store.actions.toggleSelected('welcome-title'); // remove the primary
    expect(ids(store)).toEqual(['welcome-text']);
    expect(primary(store)).toBe('welcome-text'); // next id promoted

    store.actions.toggleSelected('welcome-text'); // remove the last
    expect(ids(store)).toEqual([]);
    expect(primary(store)).toBeNull();

    // Every change re-sent {id: primary, ids: full list}.
    expect(sentSelectionPayloads).toEqual([
      { id: 'welcome-title', ids: ['welcome-title'] },
      { id: 'welcome-title', ids: ['welcome-title', 'welcome-text'] },
      { id: 'welcome-text', ids: ['welcome-text'] },
      { id: null, ids: [] },
    ]);
  });

  it('toggleSelected ignores ids that are not in the doc', () => {
    const { store, sentSelectionPayloads } = makeStore();
    store.actions.toggleSelected('welcome-title');
    store.actions.toggleSelected('no-such-id');
    expect(ids(store)).toEqual(['welcome-title']);
    expect(sentSelectionPayloads).toHaveLength(1);
  });

  it('setSelection replaces the list, dedupes, and filters stale ids', () => {
    const { store, sentSelectionPayloads } = makeStore();
    store.actions.selectComponent('welcome-cta');
    store.actions.setSelection([
      'welcome-text',
      'ghost',
      'welcome-text', // duplicate — first occurrence wins
      'welcome-title',
    ]);
    expect(ids(store)).toEqual(['welcome-text', 'welcome-title']);
    expect(primary(store)).toBe('welcome-text');
    expect(sentSelectionPayloads.at(-1)).toEqual({
      id: 'welcome-text',
      ids: ['welcome-text', 'welcome-title'],
    });
    store.actions.setSelection([]); // marquee [] clears
    expect(ids(store)).toEqual([]);
    expect(sentSelectionPayloads.at(-1)).toEqual({ id: null, ids: [] });
  });

  it('a plain selectComponent collapses any multi-selection to [id]', () => {
    const { store } = makeStore();
    store.actions.toggleSelected('welcome-title');
    store.actions.toggleSelected('welcome-text');
    store.actions.selectComponent('welcome-cta');
    expect(ids(store)).toEqual(['welcome-cta']);
    store.actions.selectComponent(null);
    expect(ids(store)).toEqual([]);
  });

  it('every selectComponent send carries {id, ids} (single and null alike)', () => {
    const { store, sentSelectionPayloads } = makeStore();
    store.actions.selectComponent('welcome-card');
    store.actions.selectComponent(null);
    expect(sentSelectionPayloads).toEqual([
      { id: 'welcome-card', ids: ['welcome-card'] },
      { id: null, ids: [] },
    ]);
  });

  it('bridgeSelect with additive toggles — it never cycles', () => {
    const { store } = makeStore();
    store.actions.bridgeSelect({ id: 'welcome-cta-label', additive: true });
    expect(ids(store)).toEqual(['welcome-cta-label']);
    // A second additive tap on the SAME id removes it — a plain repeat tap
    // would have cycled to the ancestor instead.
    store.actions.bridgeSelect({ id: 'welcome-cta-label', additive: true });
    expect(ids(store)).toEqual([]);
    store.actions.bridgeSelect({ id: 'welcome-title', additive: true });
    store.actions.bridgeSelect({ id: 'welcome-text', additive: true });
    expect(ids(store)).toEqual(['welcome-title', 'welcome-text']);
  });

  it('a multi-selection makes the next plain tap a fresh select (no cycling)', () => {
    const { store } = makeStore();
    store.actions.bridgeSelect({ id: 'welcome-cta-label' }); // plain, seeds the cycle
    store.actions.bridgeSelect({ id: 'welcome-text', additive: true }); // now 2 selected
    expect(ids(store)).toEqual(['welcome-cta-label', 'welcome-text']);
    store.actions.bridgeSelect({ id: 'welcome-cta-label' }); // plain again
    // Fresh replace with the deepest hit — NOT a hop to welcome-cta.
    expect(ids(store)).toEqual(['welcome-cta-label']);
    // And the fresh select re-seeds the cycle: the next repeat tap hones.
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    expect(ids(store)).toEqual(['welcome-cta']);
  });

  it('an additive tap resets the repeat-tap seed even when one id remains', () => {
    const { store } = makeStore();
    store.actions.bridgeSelect({ id: 'welcome-cta-label' }); // plain, seeds the cycle
    store.actions.bridgeSelect({ id: 'welcome-title', additive: true });
    store.actions.bridgeSelect({ id: 'welcome-title', additive: true }); // back to 1 selected
    expect(ids(store)).toEqual(['welcome-cta-label']);
    store.actions.bridgeSelect({ id: 'welcome-cta-label' }); // plain tap on the old spot
    // Without the additive reset this would have cycled to welcome-cta.
    expect(ids(store)).toEqual(['welcome-cta-label']);
  });

  it('bridgeMarquee replaces the list and is ignored in preview mode', () => {
    const { store, sentSelectionPayloads } = makeStore();
    store.actions.bridgeMarquee({ ids: ['welcome-title', 'welcome-text'] });
    expect(ids(store)).toEqual(['welcome-title', 'welcome-text']);
    expect(sentSelectionPayloads.at(-1)).toEqual({
      id: 'welcome-title',
      ids: ['welcome-title', 'welcome-text'],
    });
    store.actions.setMode('preview');
    store.actions.bridgeMarquee({ ids: ['welcome-cta'] });
    expect(ids(store)).toEqual(['welcome-title', 'welcome-text']); // retained
    store.actions.setMode('edit');
    store.actions.bridgeMarquee({ ids: [] }); // [] clears
    expect(ids(store)).toEqual([]);
  });

  it('after a marquee, a plain tap is a fresh select (multi blocks cycling)', () => {
    const { store } = makeStore();
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    store.actions.bridgeSelect({ id: 'welcome-cta-label' }); // cycled to welcome-cta
    expect(primary(store)).toBe('welcome-cta');
    store.actions.bridgeMarquee({ ids: ['welcome-title', 'welcome-text'] });
    store.actions.bridgeSelect({ id: 'welcome-cta-label' });
    expect(ids(store)).toEqual(['welcome-cta-label']); // fresh, not welcome-body
  });

  it('clearSelection and a background tap clear the whole list', () => {
    const { store, sentSelectionPayloads } = makeStore();
    store.actions.toggleSelected('welcome-title');
    store.actions.toggleSelected('welcome-text');
    store.actions.clearSelection();
    expect(ids(store)).toEqual([]);
    expect(sentSelectionPayloads.at(-1)).toEqual({ id: null, ids: [] });

    store.actions.toggleSelected('welcome-title');
    store.actions.toggleSelected('welcome-text');
    store.actions.bridgeSelect({ id: null }); // background tap
    expect(ids(store)).toEqual([]);
  });

  it('doc changes filter the list, keeping order and promoting the first survivor', () => {
    const { store, sentSelectionPayloads } = makeStore();
    store.actions.setSelection(['welcome-title', 'welcome-text', 'welcome-card']);
    // Replace the doc with one that keeps welcome-text + welcome-card only.
    const slim: SurfaceDoc = {
      surfaceId: SURFACE_ID,
      catalogId: CATALOG_ID,
      components: [
        { id: 'root', component: 'Column', children: ['welcome-card'] },
        { id: 'welcome-card', component: 'Card', child: 'welcome-text' },
        { id: 'welcome-text', component: 'Text', text: 'kept' },
      ],
      dataModel: {},
    };
    const result = store.actions.applyChatItems(toRenderMessages(slim));
    expect(result.ok).toBe(true);
    expect(ids(store)).toEqual(['welcome-text', 'welcome-card']);
    expect(primary(store)).toBe('welcome-text');
    expect(sentSelectionPayloads.at(-1)).toEqual({
      id: 'welcome-text',
      ids: ['welcome-text', 'welcome-card'],
    });
  });

  it('toggling on mobile switches the sidebar tab but never hides the canvas', () => {
    const { store } = makeStore({ mobile: true });
    store.actions.setRightTab('chat');
    store.actions.toggleSelected('welcome-title');
    expect(store.getState().rightTab).toBe('design');
    expect(store.getState().mobileView).toBe('canvas'); // long-press flow stays on canvas
    store.actions.bridgeMarquee({ ids: ['welcome-title', 'welcome-text'] });
    expect(store.getState().mobileView).toBe('canvas');
  });
});

describe('group delete (contract §4f)', () => {
  // root Column [card(Card → cardBody Column [inner]), txt, txt2]
  function groupDoc(): SurfaceDoc {
    return {
      surfaceId: SURFACE_ID,
      catalogId: CATALOG_ID,
      components: [
        { id: 'root', component: 'Column', children: ['card', 'txt', 'txt2'] },
        { id: 'card', component: 'Card', child: 'cardBody' },
        { id: 'cardBody', component: 'Column', children: ['inner'] },
        { id: 'inner', component: 'Text', text: 'inner' },
        { id: 'txt', component: 'Text', text: 'a' },
        { id: 'txt2', component: 'Text', text: 'b' },
      ],
      dataModel: {},
    };
  }
  function docIds(store: ReturnType<typeof makeStore>['store']) {
    return store.getState().doc.components.map((c) => c.id);
  }

  it('deletes several selected components in ONE undo snapshot + one re-render', () => {
    const { store, sentRenders } = makeStore({ doc: groupDoc() });
    store.actions.setSelection(['txt', 'txt2']);
    const result = store.actions.deleteSelected();
    expect(result.ok).toBe(true);
    expect(docIds(store)).toEqual(['root', 'card', 'cardBody', 'inner']);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(sentRenders).toHaveLength(1);
    expect(store.getState().selectedComponentIds).toEqual([]); // all deleted → cleared
    store.actions.undo(); // one step restores everything
    expect(docIds(store)).toEqual(['root', 'card', 'cardBody', 'inner', 'txt', 'txt2']);
  });

  it('subsumes descendants of another selected id (parent deleted once)', () => {
    const { store, sentRenders } = makeStore({ doc: groupDoc() });
    // inner sits under card via the child slot + children array chain.
    store.actions.setSelection(['card', 'inner']);
    const result = store.actions.deleteSelected();
    expect(result.ok).toBe(true);
    expect(docIds(store)).toEqual(['root', 'txt', 'txt2']);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(sentRenders).toHaveLength(1);
    expect(store.getState().toast).toBeNull(); // nothing skipped, nothing to report
    store.actions.undo();
    expect(docIds(store)).toEqual(['root', 'card', 'cardBody', 'inner', 'txt', 'txt2']);
  });

  it('skips single-slot occupants, reports them via toast, keeps them selected', () => {
    const { store, sentRenders, sentSelectionPayloads } = makeStore({ doc: groupDoc() });
    store.actions.setSelection(['cardBody', 'txt']); // cardBody fills card's child slot
    const result = store.actions.deleteSelected();
    expect(result.ok).toBe(true); // partial success
    expect(docIds(store)).toEqual(['root', 'card', 'cardBody', 'inner', 'txt2']);
    expect(store.getState().undoStack).toHaveLength(1);
    expect(sentRenders).toHaveLength(1);
    expect(store.getState().toast?.message).toBe('1 skipped — single-slot occupant (#cardBody)');
    // The survivor stays selected (and the catalog was told the new list).
    expect(store.getState().selectedComponentIds).toEqual(['cardBody']);
    expect(sentSelectionPayloads.at(-1)).toEqual({ id: 'cardBody', ids: ['cardBody'] });
    store.actions.undo(); // ONE step restores the partial delete
    expect(docIds(store)).toEqual(['root', 'card', 'cardBody', 'inner', 'txt', 'txt2']);
  });

  it('pluralizes the skip report', () => {
    const doc = groupDoc();
    // Give txt2 a slot parent too: a Button whose child is txt2.
    doc.components.push({ id: 'btn', component: 'Button', child: 'txt2' });
    doc.components[0] = { id: 'root', component: 'Column', children: ['card', 'txt', 'btn'] };
    const { store } = makeStore({ doc });
    store.actions.setSelection(['cardBody', 'txt2', 'txt']);
    expect(store.actions.deleteSelected().ok).toBe(true);
    expect(store.getState().toast?.message).toBe(
      '2 skipped — single-slot occupants (#cardBody, #txt2)',
    );
  });

  it('returns an error and changes nothing when every id is skipped or subsumed', () => {
    const { store, sentRenders } = makeStore({ doc: groupDoc() });
    const before = store.getState().doc;
    // inner is subsumed under cardBody; cardBody itself is slot-skipped.
    store.actions.setSelection(['cardBody', 'inner']);
    const refused = store.actions.deleteSelected();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/single slot/);
    expect(store.getState().doc).toBe(before);
    expect(store.getState().undoStack).toHaveLength(0);
    expect(sentRenders).toHaveLength(0);
    expect(store.getState().selectedComponentIds).toEqual(['cardBody', 'inner']); // retained
    expect(store.getState().events.some((e) => e.kind === 'error')).toBe(true);
  });

  it('root in the selection subsumes everything and is itself refused', () => {
    const { store } = makeStore({ doc: groupDoc() });
    const before = store.getState().doc;
    store.actions.setSelection(['root', 'txt', 'card']);
    const refused = store.actions.deleteSelected();
    expect(refused.ok).toBe(false);
    if (!refused.ok) expect(refused.error).toMatch(/clear the canvas/);
    expect(store.getState().doc).toBe(before);
  });
});
