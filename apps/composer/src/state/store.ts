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
import type { SidecarReadyPayload } from '../lib/bridge-host';
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
  ROOT_ID,
  emptyDoc,
  insertUsage,
  parseRenderMessages,
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
}

export type DrawerTab = 'json' | 'data' | 'events';

export interface ComposerState {
  doc: SurfaceDoc;
  docRevision: number;
  undoStack: SurfaceDoc[];
  redoStack: SurfaceDoc[];
  selectedContainerId: string;
  handshake: HandshakeState;
  /** Latest full DATA_MODEL_CHANGE snapshot from the renderer, if any. */
  rendererDataModel: Record<string, unknown> | null;
  events: EventEntry[];
  settings: ComposerSettings;
  glossaryOpen: boolean;
  drawerOpen: boolean;
  drawerTab: DrawerTab;
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
  // ui
  selectContainer(id: string): void;
  setDragging(dragging: boolean): void;
  toggleGlossary(): void;
  setDrawerOpen(open: boolean): void;
  setDrawerTab(tab: DrawerTab): void;
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
    selectedContainerId: ROOT_ID,
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

  /** Applies a mutated doc: snapshot for undo, clear redo, re-send RENDER_A2UI. */
  function applyDoc(doc: SurfaceDoc, label: string): void {
    const undoStack = [...state.undoStack, structuredClone(state.doc)];
    while (undoStack.length > UNDO_LIMIT) undoStack.shift();
    const selectedContainerId = doc.components.some((c) => c.id === state.selectedContainerId)
      ? state.selectedContainerId
      : ROOT_ID;
    set({
      doc,
      docRevision: state.docRevision + 1,
      undoStack,
      redoStack: [],
      selectedContainerId,
      ...pushEvent(
        'lifecycle',
        `RENDER_A2UI sent — ${label} (${doc.components.length} components)`,
      ),
    });
    sendRender(doc);
  }

  function restoreDoc(doc: SurfaceDoc, patch: Partial<ComposerState>, label: string): void {
    const selectedContainerId = doc.components.some((c) => c.id === state.selectedContainerId)
      ? state.selectedContainerId
      : ROOT_ID;
    set({
      doc,
      docRevision: state.docRevision + 1,
      selectedContainerId,
      ...patch,
      ...pushEvent(
        'lifecycle',
        `RENDER_A2UI sent — ${label} (${doc.components.length} components)`,
      ),
    });
    sendRender(doc);
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
      const features = Array.isArray(payload?.features) ? payload.features.join(', ') : '';
      set({
        handshake: { ...state.handshake, sidecar: true },
        ...pushEvent('lifecycle', `COMPOSERX sidecar ready (${features || 'no features'})`),
      });
    },
    bridgeUnknown(type, payload) {
      set(pushEvent('unknown', `Unhandled message: ${type}`, truncate(safeJson(payload))));
    },
    handshakeReset() {
      set({
        handshake: initialHandshake(),
        rendererDataModel: null,
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

    selectContainer(id) {
      set({ selectedContainerId: id });
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
