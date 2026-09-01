/**
 * Single composer store: doc + undo/redo, handshake data, event log, settings.
 * A tiny external store (subscribe/getState) consumed via useSyncExternalStore,
 * with an injectable RenderPort seam so tests run without a real bridge host.
 */
import type {
  CatalogHandshakePayload,
  ConsoleLogPayload,
  DataModelChangePayload,
  RenderA2uiItem,
  SendToServerPayload,
} from 'a2ui-bridge/messages';
import type { ComponentUsages } from 'a2ui-bridge/render-config';
import type {
  ComposerMode,
  PropSpecsMap,
  PropSpecsPayload,
  SelectionPayload,
  SidecarReadyPayload,
} from '../lib/bridge-host';
import { parseSidecarFeatures } from '../lib/bridge-host';
import type { Theme } from '../lib/settings';
import {
  DEFAULT_MODEL,
  STORAGE_KEYS,
  applyShellTheme,
  loadTheme,
  readSetting,
  resolveRendererUrl,
  writeSetting,
} from '../lib/settings';
import type { InsertTarget, SurfaceDoc } from '../lib/surface-doc';
import {
  emptyDoc,
  insertUsage,
  parseRenderMessages,
  removeComponent,
  removeComponentProp,
  setComponentProp,
  toRenderMessages,
} from '../lib/surface-doc';
import { welcomeDoc } from '../lib/welcome';

export const UNDO_LIMIT = 50;
export const EVENT_LOG_LIMIT = 200;

export type EventKind = 'lifecycle' | 'action' | 'console' | 'unknown' | 'error';

export interface EventEntry {
  id: number;
  ts: number;
  kind: EventKind;
  level?: string;
  summary: string;
  detail?: string;
}

/** What the store needs from the bridge host (injectable for tests). */
export interface RenderPort {
  sendRender(items: RenderA2uiItem[]): void;
  sendTheme(theme: Theme): void;
  sendSetMode(payload: { mode: ComposerMode }): void;
  sendSetSelection(payload: { id: string | null }): void;
}

export interface ComposerSettings {
  rendererUrl: string;
  apiKey: string;
  model: string;
  theme: Theme;
}

export interface HandshakeState {
  ready: boolean;
  timedOut: boolean;
  catalog: Record<string, unknown> | null;
  catalogError: string | null;
  usages: ComponentUsages | null;
  sidecar: boolean;
  /** Parsed SIDECAR_READY features — each one independently optional (§4). */
  sidecarFeatures: string[];
}

export type DrawerTab = 'json' | 'data' | 'events';
export type RightTab = 'design' | 'chat';

export interface ComposerState {
  doc: SurfaceDoc;
  docRevision: number;
  undoStack: SurfaceDoc[];
  redoStack: SurfaceDoc[];
  /** Unified Figma-style selection shared by canvas, tree, and inspector. */
  selectedComponentId: string | null;
  /** Edit (canvas clicks select) vs preview (live components). Not persisted. */
  mode: ComposerMode;
  /** Per-component prop specs from COMPOSERX_PROP_SPECS; null until arrived. */
  propSpecs: PropSpecsMap | null;
  handshake: HandshakeState;
  /** Latest full DATA_MODEL_CHANGE snapshot from the renderer, if any. */
  rendererDataModel: Record<string, unknown> | null;
  events: EventEntry[];
  settings: ComposerSettings;
  glossaryOpen: boolean;
  drawerOpen: boolean;
  drawerTab: DrawerTab;
  /** Which right-sidebar tab is shown; selection auto-switches to 'design'. */
  rightTab: RightTab;
  settingsOpen: boolean;
  /** True while a glossary entry is being dragged (activates the drop overlay). */
  dragging: boolean;
}

export type ActionResult = { ok: true } | { ok: false; error: string };

function initialHandshake(): HandshakeState {
  return {
    ready: false,
    timedOut: false,
    catalog: null,
    catalogError: null,
    usages: null,
    sidecar: false,
    sidecarFeatures: [],
  };
}

function truncate(text: string, max = 300): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isRecordValue(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ComposerStoreOptions {
  doc?: SurfaceDoc;
  settings?: Partial<ComposerSettings>;
}

export interface ComposerStore {
  getState(): ComposerState;
  subscribe(listener: () => void): () => void;
  attachPort(port: RenderPort | null): void;
  actions: ComposerActions;
}

export interface ComposerActions {
  // bridge events (wired from BridgeHost callbacks)
  bridgeReady(): void;
  bridgeCatalog(payload: CatalogHandshakePayload): void;
  bridgeUsages(payload: ComponentUsages): void;
  bridgeDataModel(payload: DataModelChangePayload): void;
  bridgeAction(payload: SendToServerPayload): void;
  bridgeConsole(payload: ConsoleLogPayload): void;
  bridgeSidecarReady(payload: SidecarReadyPayload): void;
  bridgeSelect(payload: SelectionPayload): void;
  bridgePropSpecs(payload: PropSpecsPayload): void;
  bridgeUnknown(type: string, payload: unknown): void;
  handshakeReset(): void;
  handshakeTimedOut(): void;
  // document ops (all undo-able)
  insertComponent(name: string, target?: InsertTarget): ActionResult;
  applyJsonText(text: string): ActionResult;
  applyChatItems(items: unknown): ActionResult;
  clearCanvas(): void;
  undo(): void;
  redo(): void;
  commitProp(id: string, key: string, value: unknown): ActionResult;
  removeProp(id: string, key: string): ActionResult;
  deleteSelected(): ActionResult;
  // selection + mode
  selectComponent(id: string | null): void;
  setMode(mode: ComposerMode): void;
  // ui
  setDragging(dragging: boolean): void;
  toggleGlossary(): void;
  setDrawerOpen(open: boolean): void;
  setDrawerTab(tab: DrawerTab): void;
  setRightTab(tab: RightTab): void;
  setSettingsOpen(open: boolean): void;
  // settings
  setTheme(theme: Theme): void;
  setRendererUrl(url: string | null): void;
  setApiKey(key: string): void;
  setModel(model: string): void;
  logEvent(kind: EventKind, summary: string, detail?: string, level?: string): void;
}

export function createComposerStore(options: ComposerStoreOptions = {}): ComposerStore {
  let port: RenderPort | null = null;
  let eventId = 0;

  let state: ComposerState = {
    doc: options.doc ?? welcomeDoc(),
    docRevision: 0,
    undoStack: [],
    redoStack: [],
    selectedComponentId: null,
    mode: 'edit',
    propSpecs: null,
    handshake: initialHandshake(),
    rendererDataModel: null,
    events: [],
    settings: {
      rendererUrl: resolveRendererUrl(),
      apiKey: readSetting(STORAGE_KEYS.apiKey) ?? '',
      model: readSetting(STORAGE_KEYS.model) ?? DEFAULT_MODEL,
      theme: loadTheme(),
      ...options.settings,
    },
    glossaryOpen: true,
    drawerOpen: true,
    drawerTab: 'json',
    rightTab: 'design',
    settingsOpen: false,
    dragging: false,
  };

  const listeners = new Set<() => void>();

  function set(patch: Partial<ComposerState>): void {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  }

  function pushEvent(
    kind: EventKind,
    summary: string,
    detail?: string,
    level?: string,
  ): Partial<ComposerState> {
    const entry: EventEntry = { id: ++eventId, ts: Date.now(), kind, summary, detail, level };
    return { events: [entry, ...state.events].slice(0, EVENT_LOG_LIMIT) };
  }

  function log(kind: EventKind, summary: string, detail?: string, level?: string): void {
    set(pushEvent(kind, summary, detail, level));
  }

  function sendRender(doc: SurfaceDoc): void {
    port?.sendRender(toRenderMessages(doc));
  }

  /**
   * Selection survives a doc change only while its id still exists; a stale
   * id clears to null (and the catalog is told, so its outline goes away).
   * Returns the state patch; the SET_SELECTION side effect runs in the caller
   * after set() so the renderer sees selection changes in order.
   */
  function reconcileSelection(doc: SurfaceDoc): {
    patch: Partial<ComposerState>;
    cleared: boolean;
  } {
    const id = state.selectedComponentId;
    if (id === null || doc.components.some((c) => c.id === id)) {
      return { patch: {}, cleared: false };
    }
    return { patch: { selectedComponentId: null }, cleared: true };
  }

  /** Applies a mutated doc: snapshot for undo, clear redo, re-send RENDER_A2UI. */
  function applyDoc(doc: SurfaceDoc, label: string): void {
    const undoStack = [...state.undoStack, structuredClone(state.doc)];
    while (undoStack.length > UNDO_LIMIT) undoStack.shift();
    const selection = reconcileSelection(doc);
    set({
      doc,
      docRevision: state.docRevision + 1,
      undoStack,
      redoStack: [],
      ...selection.patch,
      ...pushEvent(
        'lifecycle',
        `RENDER_A2UI sent — ${label} (${doc.components.length} components)`,
      ),
    });
    sendRender(doc);
    if (selection.cleared) port?.sendSetSelection({ id: null });
  }

  function restoreDoc(doc: SurfaceDoc, patch: Partial<ComposerState>, label: string): void {
    const selection = reconcileSelection(doc);
    set({
      doc,
      docRevision: state.docRevision + 1,
      ...selection.patch,
      ...patch,
      ...pushEvent(
        'lifecycle',
        `RENDER_A2UI sent — ${label} (${doc.components.length} components)`,
      ),
    });
    sendRender(doc);
    if (selection.cleared) port?.sendSetSelection({ id: null });
  }

  const actions: ComposerActions = {
    bridgeReady() {
      set({
        handshake: { ...state.handshake, ready: true, timedOut: false },
        ...pushEvent('lifecycle', 'RENDERER_READY — handshake started'),
      });
    },
    bridgeCatalog(payload) {
      if (payload && typeof payload === 'object' && payload.error) {
        const message =
          typeof payload.error.message === 'string' ? payload.error.message : 'unknown error';
        set({
          handshake: { ...state.handshake, catalog: null, catalogError: message },
          ...pushEvent('error', `A2UI_CATALOG error: ${message}`),
        });
        return;
      }
      const catalog =
        payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
      const title = catalog && typeof catalog.title === 'string' ? catalog.title : 'catalog';
      set({
        handshake: { ...state.handshake, catalog, catalogError: null },
        ...pushEvent('lifecycle', `A2UI_CATALOG received (${title})`),
      });
    },
    bridgeUsages(payload) {
      const usages = payload && typeof payload === 'object' ? payload : null;
      const count = usages ? Object.keys(usages).length : 0;
      set({
        handshake: { ...state.handshake, usages },
        ...pushEvent('lifecycle', `COMPONENT_USAGES received (${count} components)`),
      });
    },
    bridgeDataModel(payload) {
      const value = payload?.updateDataModel?.value;
      const snapshot =
        value && typeof value === 'object' && !Array.isArray(value)
          ? (value as Record<string, unknown>)
          : null;
      set({ rendererDataModel: snapshot });
    },
    bridgeAction(payload) {
      set(pushEvent('action', 'SEND_TO_SERVER', truncate(safeJson(payload?.action ?? payload))));
    },
    bridgeConsole(payload) {
      const level = typeof payload?.level === 'string' ? payload.level : 'log';
      const message = typeof payload?.message === 'string' ? payload.message : safeJson(payload);
      set(pushEvent('console', truncate(message), payload?.stack, level));
    },
    bridgeSidecarReady(payload) {
      const sidecarFeatures = parseSidecarFeatures(payload);
      set({
        handshake: { ...state.handshake, sidecar: true, sidecarFeatures },
        ...pushEvent(
          'lifecycle',
          `COMPOSERX sidecar ready (${sidecarFeatures.join(', ') || 'no features'})`,
        ),
      });
    },
    bridgeSelect(payload) {
      // Belt over the catalog's suspenders: in preview mode canvas clicks
      // are live component interactions, never selection (§4c).
      if (state.mode === 'preview') return;
      const id = payload && typeof payload === 'object' ? payload.id : null;
      actions.selectComponent(typeof id === 'string' ? id : null);
    },
    bridgePropSpecs(payload) {
      const components =
        payload && typeof payload === 'object' && isRecordValue(payload.components)
          ? (payload.components as PropSpecsMap)
          : null;
      if (!components) {
        set(pushEvent('error', 'COMPOSERX_PROP_SPECS payload malformed — ignored'));
        return;
      }
      set({
        propSpecs: components,
        ...pushEvent(
          'lifecycle',
          `COMPOSERX_PROP_SPECS received (${Object.keys(components).length} components)`,
        ),
      });
    },
    bridgeUnknown(type, payload) {
      set(pushEvent('unknown', `Unhandled message: ${type}`, truncate(safeJson(payload))));
    },
    handshakeReset() {
      set({
        handshake: initialHandshake(),
        rendererDataModel: null,
        // A different renderer may not speak prop-specs; stale specs from the
        // previous renderer must not drive the inspector.
        propSpecs: null,
        ...pushEvent('lifecycle', 'Renderer iframe mounted — waiting for RENDERER_READY'),
      });
    },
    handshakeTimedOut() {
      if (state.handshake.ready) return;
      set({
        handshake: { ...state.handshake, timedOut: true },
        ...pushEvent('error', 'Renderer handshake timed out after 10s'),
      });
    },

    insertComponent(name, target) {
      const usages = state.handshake.usages;
      const usage = usages?.[name];
      if (!usage) {
        const error = usages
          ? `No usage snippet for component "${name}"`
          : 'Component usages have not arrived from the renderer yet';
        log('error', error);
        return { ok: false, error };
      }
      try {
        const doc = insertUsage(state.doc, usage, target);
        applyDoc(doc, `insert ${name}`);
        return { ok: true };
      } catch (err) {
        const error = errorMessage(err);
        log('error', `Insert ${name} failed: ${error}`);
        return { ok: false, error };
      }
    },
    applyJsonText(text) {
      try {
        const doc = parseRenderMessages(JSON.parse(text));
        applyDoc(doc, 'JSON apply');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
    applyChatItems(items) {
      try {
        const doc = parseRenderMessages(items);
        applyDoc(doc, 'chat apply');
        return { ok: true };
      } catch (err) {
        return { ok: false, error: errorMessage(err) };
      }
    },
    clearCanvas() {
      applyDoc(emptyDoc(), 'clear canvas');
    },
    undo() {
      const previous = state.undoStack.at(-1);
      if (!previous) return;
      restoreDoc(
        previous,
        {
          undoStack: state.undoStack.slice(0, -1),
          redoStack: [...state.redoStack, structuredClone(state.doc)],
        },
        'undo',
      );
    },
    redo() {
      const next = state.redoStack.at(-1);
      if (!next) return;
      restoreDoc(
        next,
        {
          redoStack: state.redoStack.slice(0, -1),
          undoStack: [...state.undoStack, structuredClone(state.doc)],
        },
        'redo',
      );
    },
    commitProp(id, key, value) {
      try {
        const doc = setComponentProp(state.doc, id, key, value);
        applyDoc(doc, `set ${id}.${key}`);
        return { ok: true };
      } catch (err) {
        const error = errorMessage(err);
        log('error', `Set prop ${id}.${key} failed: ${error}`);
        return { ok: false, error };
      }
    },
    removeProp(id, key) {
      try {
        const doc = removeComponentProp(state.doc, id, key);
        applyDoc(doc, `remove ${id}.${key}`);
        return { ok: true };
      } catch (err) {
        const error = errorMessage(err);
        log('error', `Remove prop ${id}.${key} failed: ${error}`);
        return { ok: false, error };
      }
    },
    deleteSelected() {
      const id = state.selectedComponentId;
      if (id === null) {
        return { ok: false, error: 'nothing selected' };
      }
      try {
        const doc = removeComponent(state.doc, id);
        applyDoc(doc, `remove ${id}`);
        return { ok: true };
      } catch (err) {
        const error = errorMessage(err);
        log('error', `Remove ${id} failed: ${error}`);
        return { ok: false, error };
      }
    },

    selectComponent(id) {
      if (id !== null && !state.doc.components.some((c) => c.id === id)) {
        return; // stale id (race with a re-render) — keep the current selection
      }
      // Selecting a component brings the Design inspector forward; manual tab
      // clicks stick until the next selection. Deselecting leaves the tab.
      const patch: Partial<ComposerState> =
        id !== null
          ? { selectedComponentId: id, rightTab: 'design' }
          : { selectedComponentId: null };
      set(patch);
      port?.sendSetSelection({ id });
    },
    setMode(mode) {
      if (state.mode === mode) return;
      set({ mode, ...pushEvent('lifecycle', `Mode set to ${mode} (COMPOSERX_SET_MODE)`) });
      port?.sendSetMode({ mode });
    },
    setDragging(dragging) {
      if (state.dragging !== dragging) set({ dragging });
    },
    toggleGlossary() {
      set({ glossaryOpen: !state.glossaryOpen });
    },
    setDrawerOpen(open) {
      set({ drawerOpen: open });
    },
    setDrawerTab(tab) {
      set({ drawerTab: tab, drawerOpen: true });
    },
    setRightTab(tab) {
      set({ rightTab: tab });
    },
    setSettingsOpen(open) {
      set({ settingsOpen: open });
    },

    setTheme(theme) {
      writeSetting(STORAGE_KEYS.theme, theme);
      applyShellTheme(theme);
      set({
        settings: { ...state.settings, theme },
        ...pushEvent('lifecycle', `Theme set to ${theme} (shell + SET_THEME)`),
      });
      port?.sendTheme(theme);
    },
    setRendererUrl(url) {
      writeSetting(STORAGE_KEYS.rendererUrl, url);
      const resolved = resolveRendererUrl();
      set({
        settings: { ...state.settings, rendererUrl: resolved },
        ...pushEvent('lifecycle', `Renderer URL set to ${resolved}`),
      });
    },
    setApiKey(key) {
      writeSetting(STORAGE_KEYS.apiKey, key === '' ? null : key);
      set({ settings: { ...state.settings, apiKey: key } });
    },
    setModel(model) {
      writeSetting(STORAGE_KEYS.model, model);
      set({ settings: { ...state.settings, model } });
    },
    logEvent(kind, summary, detail, level) {
      log(kind, summary, detail, level);
    },
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attachPort(nextPort) {
      port = nextPort;
    },
    actions,
  };
}
