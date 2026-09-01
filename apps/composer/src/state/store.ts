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
  DndTargetPayload,
  MarqueePayload,
  MoveDropPayload,
  MoveIdPayload,
  PropSpecsMap,
  PropSpecsPayload,
  SelectionPayload,
  SetSelectionPayload,
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
  ROOT_ID,
  ancestorChainOf,
  canMoveTo,
  emptyDoc,
  insertTargetFor,
  insertUsage,
  moveComponent,
  parseRenderMessages,
  partitionForDelete,
  removeComponent,
  removeComponentProp,
  setComponentProp,
  toRenderMessages,
} from '../lib/surface-doc';
import { matchMobile } from '../lib/viewport';
import { welcomeDoc } from '../lib/welcome';

export const UNDO_LIMIT = 50;
export const EVENT_LOG_LIMIT = 200;
/** How long the mobile insert toast stays up (contract §7b: ~2.5s). */
export const TOAST_DURATION_MS = 2500;

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
  /** Every selection change re-sends `{id: primary, ids: full list}` (§4f). */
  sendSetSelection(payload: SetSelectionPayload): void;
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
/** Which single-column view is shown ≤900px (contract §7b). Desktop ignores it. */
export type MobileView = 'canvas' | 'add' | 'design' | 'chat';

/** One toast at a time (contract §7b `mtoast`); `id` guards stale auto-clears. */
export interface ToastState {
  id: number;
  message: string;
}

/** Viewport-CSS-px rect; DOMRect satisfies it, tests can pass a literal. */
export interface CanvasDndRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/**
 * What the glossary's pointer-based grip drag needs from the canvas pane
 * (contract §7b): the iframe rect for over/out hit-testing, the SAME
 * rAF-throttled COMPOSERX_DND_HOVER path the HTML5 overlay drives (hoverAt
 * converts viewport coords by subtracting the iframe bounding rect), and the
 * held COMPOSERX_DND_TARGET reply. CanvasPane registers it on mount via
 * attachCanvasDnd (injectable for tests, like RenderPort).
 */
export interface CanvasDndSurface {
  getIframeRect(): CanvasDndRect | null;
  hoverAt(clientX: number, clientY: number): void;
  endHover(): void;
  currentTarget(): DndTargetPayload | null;
}

export interface ComposerState {
  doc: SurfaceDoc;
  docRevision: number;
  undoStack: SurfaceDoc[];
  redoStack: SurfaceDoc[];
  /**
   * Unified Figma-style selection shared by canvas, tree, and inspector —
   * PRIMARY only, kept as derived state (`selectedComponentIds[0] ?? null`,
   * always updated in the same set()) because most consumers are
   * single-selection surfaces (inspector form, insert target, breadcrumb).
   */
  selectedComponentId: string | null;
  /**
   * The full selection list (contract §4f): ordered, deduped, primary first.
   * Plain selects replace it with [id]/[]; additive selects toggle; marquees
   * replace wholesale; doc changes filter out stale ids.
   */
  selectedComponentIds: string[];
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
  /** True ≤900px (contract §7b); tracked live via matchMedia. */
  mobile: boolean;
  /** The active single-column view on mobile; desktop ignores it. */
  mobileView: MobileView;
  /** The current mobile toast, or null. Auto-clears after TOAST_DURATION_MS. */
  toast: ToastState | null;
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
  /** Initial breakpoint state; defaults to matchMobile(). Injectable for tests. */
  mobile?: boolean;
}

export interface ComposerStore {
  getState(): ComposerState;
  subscribe(listener: () => void): () => void;
  attachPort(port: RenderPort | null): void;
  /** CanvasPane registers the live canvas DnD surface here (grip drags use it). */
  attachCanvasDnd(surface: CanvasDndSurface | null): void;
  getCanvasDnd(): CanvasDndSurface | null;
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
  /** COMPOSERX_MARQUEE (§4f): replace the selection list with the swept ids. */
  bridgeMarquee(payload: MarqueePayload): void;
  bridgePropSpecs(payload: PropSpecsPayload): void;
  bridgeMoveStart(payload: MoveIdPayload): void;
  bridgeMoveDrop(payload: MoveDropPayload): void;
  bridgeMoveCancel(payload: MoveIdPayload): void;
  bridgeUnknown(type: string, payload: unknown): void;
  handshakeReset(): void;
  handshakeTimedOut(): void;
  // document ops (all undo-able)
  insertComponent(name: string, target?: InsertTarget): ActionResult;
  /**
   * Shared drop-insert path (contract §7b): a held COMPOSERX_DND_TARGET wins;
   * otherwise the structural fallback inserts at the end of the container
   * derived from the unified selection. Used by BOTH the HTML5 drop overlay
   * and the pointer-based grip drag.
   */
  insertFromDrag(name: string, target: DndTargetPayload | null): ActionResult;
  applyJsonText(text: string): ActionResult;
  applyChatItems(items: unknown): ActionResult;
  clearCanvas(): void;
  undo(): void;
  redo(): void;
  commitProp(id: string, key: string, value: unknown): ActionResult;
  removeProp(id: string, key: string): ActionResult;
  deleteSelected(): ActionResult;
  /** Re-homes `id` into `containerId` at `index` (AFTER-removal semantics, §5). */
  moveComponentTo(id: string, containerId: string, index: number): ActionResult;
  // selection + mode
  /**
   * On mobile, selecting brings the full-screen Design view forward (mirror
   * of the desktop tab auto-switch) unless `opts.autoView` is false — the
   * canvas-move gesture (§4e) selects at MOVE_START but must keep the canvas
   * visible for the rest of the in-flight drag (contract §7b).
   */
  selectComponent(id: string | null, opts?: { autoView?: boolean }): void;
  /**
   * Additive toggle (§4f): shift-click / long-press / tree shift-click. Adds
   * the id to the end of the list or removes it; removing the primary
   * promotes the next id; removing the last clears. Unknown ids are ignored.
   * Never switches the mobile view — building a multi-selection is an
   * in-flight canvas interaction (same reasoning as MOVE_START's autoView).
   */
  toggleSelected(id: string): void;
  /**
   * Replace the whole selection list (§4f marquee): dedupes (first occurrence
   * wins) and filters to ids present in the doc. [] clears.
   */
  setSelection(ids: string[]): void;
  /** Clear the whole selection list (Escape / background click / Clear button). */
  clearSelection(): void;
  setMode(mode: ComposerMode): void;
  // ui
  setDragging(dragging: boolean): void;
  toggleGlossary(): void;
  setDrawerOpen(open: boolean): void;
  setDrawerTab(tab: DrawerTab): void;
  setRightTab(tab: RightTab): void;
  setSettingsOpen(open: boolean): void;
  // mobile (contract §7b)
  setMobile(mobile: boolean): void;
  setMobileView(view: MobileView): void;
  showToast(message: string): void;
  dismissToast(): void;
  // settings
  setTheme(theme: Theme): void;
  setRendererUrl(url: string | null): void;
  setApiKey(key: string): void;
  setModel(model: string): void;
  logEvent(kind: EventKind, summary: string, detail?: string, level?: string): void;
}

export function createComposerStore(options: ComposerStoreOptions = {}): ComposerStore {
  let port: RenderPort | null = null;
  let canvasDnd: CanvasDndSurface | null = null;
  /**
   * The last COMPOSERX_SELECT hit id — the seed of repeat-tap ancestor
   * cycling (contract §7 ancestor honing). Internal bookkeeping, not React
   * state: nothing renders from it. Invariant: it always names a component
   * in the CURRENT doc (or is null) — bridgeSelect only stores ids the doc
   * contains, and doc changes that remove it reset it, so a later reuse of
   * the same id can never masquerade as a repeat tap.
   */
  let lastCanvasHitId: string | null = null;
  let eventId = 0;
  let toastId = 0;
  let toastTimer: ReturnType<typeof setTimeout> | null = null;
  const initialMobile = options.mobile ?? matchMobile();

  let state: ComposerState = {
    doc: options.doc ?? welcomeDoc(),
    docRevision: 0,
    undoStack: [],
    redoStack: [],
    selectedComponentId: null,
    selectedComponentIds: [],
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
    // Contract §7b: the drawer starts CLOSED on mobile (screen space).
    drawerOpen: !initialMobile,
    drawerTab: 'json',
    rightTab: 'design',
    settingsOpen: false,
    dragging: false,
    mobile: initialMobile,
    mobileView: 'canvas',
    toast: null,
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
   * The state patch for a new selection list: the list plus its derived
   * primary (`ids[0] ?? null`), always written in the same set() so no
   * consumer ever observes them out of sync.
   */
  function selectionPatch(ids: string[]): Partial<ComposerState> {
    return { selectedComponentIds: ids, selectedComponentId: ids[0] ?? null };
  }

  /** Contract §4f: every selection change re-sends `{id: primary, ids}`. */
  function sendSelection(ids: string[]): void {
    port?.sendSetSelection({ id: ids[0] ?? null, ids });
  }

  /**
   * The selection survives a doc change only where its ids still exist: the
   * LIST is filtered (order kept — the first survivor becomes the primary),
   * and the catalog is told so stale outlines go away. Returns the state
   * patch; the SET_SELECTION side effect runs in the caller after set() so
   * the renderer sees selection changes in order.
   */
  function reconcileSelection(doc: SurfaceDoc): {
    patch: Partial<ComposerState>;
    changed: boolean;
    ids: string[];
  } {
    const current = state.selectedComponentIds;
    const ids = current.filter((id) => doc.components.some((c) => c.id === id));
    if (ids.length === current.length) {
      return { patch: {}, changed: false, ids: current };
    }
    return { patch: selectionPatch(ids), changed: true, ids };
  }

  /**
   * Doc changes that remove the last canvas hit id reset the repeat-tap
   * cycle (contract §7 ancestor honing): a doc where the id later reappears
   * (undo/redo, JSON or chat apply) is a NEW component as far as tap
   * cycling is concerned — treating the next tap on it as a repeat could
   * jump straight to an ancestor the user never cycled to. Ids that survive
   * the change keep the cycle alive (the chain is recomputed against the
   * current doc on every SELECT, so structural changes stay safe).
   */
  function reconcileCanvasHit(doc: SurfaceDoc): void {
    if (lastCanvasHitId !== null && !doc.components.some((c) => c.id === lastCanvasHitId)) {
      lastCanvasHitId = null;
    }
  }

  /** Applies a mutated doc: snapshot for undo, clear redo, re-send RENDER_A2UI. */
  function applyDoc(doc: SurfaceDoc, label: string): void {
    const undoStack = [...state.undoStack, structuredClone(state.doc)];
    while (undoStack.length > UNDO_LIMIT) undoStack.shift();
    reconcileCanvasHit(doc);
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
    if (selection.changed) sendSelection(selection.ids);
  }

  function restoreDoc(doc: SurfaceDoc, patch: Partial<ComposerState>, label: string): void {
    reconcileCanvasHit(doc);
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
    if (selection.changed) sendSelection(selection.ids);
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
      const raw = payload && typeof payload === 'object' ? payload.id : null;
      const id = typeof raw === 'string' ? raw : null;
      if (id === null) {
        // Background tap: clear the WHOLE selection list (§4f) as always
        // AND reset the repeat-tap cycle.
        lastCanvasHitId = null;
        actions.clearSelection();
        return;
      }
      if (payload.additive === true) {
        // Additive select (§4f: shift-click / long-press): toggle the id in
        // or out of the list — NEVER cycle — and reset the repeat-tap seed:
        // a toggle breaks the tap rhythm, so the next PLAIN tap on the same
        // spot must be a fresh deepest select, not an ancestor hop.
        lastCanvasHitId = null;
        actions.toggleSelected(id);
        return;
      }
      // Repeat-tap ancestor cycling (contract §7 ancestor honing): the
      // catalog always posts the DEEPEST hit, so tapping the same spot again
      // while the selection sits somewhere in that hit's inclusive ancestor
      // chain hones one ancestor up — deepest → … → root, then wraps back
      // to the deepest. The chain-membership check doubles as the reset for
      // selections made elsewhere in the meantime (tree, breadcrumb,
      // Escape): a selection outside the chain (or none) makes this a fresh
      // select. The chain hops the same edges as the tree (children arrays
      // AND child/trigger/content/tabs[].child slots) and is recomputed
      // against the current doc on every tap, so it is never stale.
      // §4f guard: cycling applies ONLY to plain single selects — with a
      // multi-selection (length > 1) the next plain tap is a fresh replace
      // (the chain-membership check uses the primary, but the length gate
      // fires first, so a multi-selection never hones).
      const chain = ancestorChainOf(state.doc, id);
      const selected = state.selectedComponentId;
      if (
        state.selectedComponentIds.length === 1 &&
        id === lastCanvasHitId &&
        selected !== null &&
        chain.includes(selected)
      ) {
        // One ancestor up from the CURRENT selection; past the top (root, or
        // a parentless orphan) wrap back to the deepest hit itself. Each
        // step goes through selectComponent, so SET_SELECTION re-sends and
        // the canvas outline shows the layer the user is on.
        const next = chain[chain.indexOf(selected) + 1] ?? id;
        actions.selectComponent(next);
        return; // lastCanvasHitId already === id
      }
      // Fresh select: replaces any multi-selection with just [id] (§4f).
      // Only ids present in the current doc seed the cycle (chain is [] for
      // stale ids — selectComponent ignores those anyway).
      lastCanvasHitId = chain.length > 0 ? id : null;
      actions.selectComponent(id);
    },
    bridgeMarquee(payload) {
      // Marquee is an edit-mode gesture (§4f); mirror the SELECT guard.
      if (state.mode === 'preview') return;
      actions.setSelection(payload.ids);
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
    // MOVE_* messages (§4e) are edit-mode gestures; in preview mode they are
    // ignored entirely — belt over the catalog's suspenders, which should not
    // start moves in preview mode in the first place.
    bridgeMoveStart(payload) {
      if (state.mode === 'preview') return;
      // A move gesture breaks the tap rhythm: it suppresses its own SELECT
      // and re-homes the layout, so continuing an older repeat-tap cycle
      // across it (the lift anchor usually sits IN the old hit's chain)
      // would jump to an ancestor the user never tapped toward. Reset.
      lastCanvasHitId = null;
      log('lifecycle', `COMPOSERX_MOVE_START — lifting "${payload.id}"`);
      // autoView false: the §4e drag is still in flight inside the iframe —
      // hiding the canvas view now would leave the user dropping blind
      // (contract §7b: canvas move must keep working under touch).
      actions.selectComponent(payload.id, { autoView: false });
    },
    bridgeMoveDrop(payload) {
      if (state.mode === 'preview') return;
      // moveComponentTo validates via canMoveTo: an invalid drop logs the
      // refusal reason and leaves the doc unchanged (§4e — the composer is
      // authoritative, the catalog mutates nothing itself).
      actions.moveComponentTo(payload.id, payload.containerId, payload.index);
    },
    bridgeMoveCancel(payload) {
      if (state.mode === 'preview') return;
      log('lifecycle', `COMPOSERX_MOVE_CANCEL — move of "${payload.id}" abandoned`);
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
      // Where the snippet lands (insertUsage defaults to root) — named in the
      // mobile toast below.
      const landedIn = target?.containerId ?? ROOT_ID;
      try {
        const doc = insertUsage(state.doc, usage, target);
        applyDoc(doc, `insert ${name}`);
        // Contract §7b: on mobile every glossary insert (tap or grip drop)
        // brings the canvas forward and confirms what landed where — `title`
        // tooltips don't exist on touch, the toast carries the affordance.
        if (state.mobile) {
          if (state.mobileView !== 'canvas') set({ mobileView: 'canvas' });
          actions.showToast(`${name} → #${landedIn}`);
        }
        return { ok: true };
      } catch (err) {
        const error = errorMessage(err);
        log('error', `Insert ${name} failed: ${error}`);
        return { ok: false, error };
      }
    },
    insertFromDrag(name, target) {
      if (target && target.containerId !== null) {
        // Sidecar hit-test result: containerId/index already resolved catalog-side.
        return actions.insertComponent(name, {
          containerId: target.containerId,
          index: target.index,
        });
      }
      // Structural fallback (no sidecar / no hit): end of the container
      // derived from the unified selection (contract §7).
      return actions.insertComponent(name, {
        containerId: insertTargetFor(state.doc, state.selectedComponentId),
      });
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
        // Unchanged-value commits (e.g. Enter followed by the blur it causes)
        // must not push an undo snapshot: one edit, one step.
        const existing = state.doc.components.find((c) => c.id === id);
        if (
          existing &&
          key in existing &&
          JSON.stringify(existing[key]) === JSON.stringify(value)
        ) {
          return { ok: true };
        }
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
      // Group delete (contract §4f): consider the whole selected set. Ids
      // whose ancestor is also selected are subsumed (the ancestor's removal
      // takes them); of the rest, root and single-slot occupants are skipped
      // and reported, everything else is removed in ONE undo snapshot.
      const ids = state.selectedComponentIds;
      if (ids.length === 0) {
        return { ok: false, error: 'nothing selected' };
      }
      const { deletable, skipped } = partitionForDelete(state.doc, ids);
      if (deletable.length === 0) {
        if (skipped.length === 0) {
          return { ok: false, error: 'nothing selected' }; // all ids stale
        }
        const names = skipped.map((s) => `#${s}`).join(', ');
        const error = skipped.every((s) => s === ROOT_ID)
          ? `cannot remove "${ROOT_ID}" — clear the canvas instead`
          : `cannot delete ${names}: single slot occupant${skipped.length === 1 ? '' : 's'} — ` +
            'delete the parent instead, or edit via JSON';
        log('error', `Remove ${names} refused: ${error}`);
        return { ok: false, error };
      }
      try {
        // Sequential removals on a working doc, ONE applyDoc = one undo
        // snapshot + one re-render. An id an earlier subtree already took
        // out (shared-reference exotics the subsumption pass cannot see) is
        // simply skipped — removeComponent would throw on it.
        let doc = state.doc;
        for (const id of deletable) {
          if (!doc.components.some((c) => c.id === id)) continue;
          doc = removeComponent(doc, id);
        }
        applyDoc(doc, `remove ${deletable.join(', ')}`);
        if (skipped.length > 0) {
          // Contract §4f: partial deletes report the survivors — the skipped
          // ids stay selected (they still exist), so the inspector's hint
          // shows the reason too.
          const names = skipped.map((s) => `#${s}`).join(', ');
          actions.showToast(
            `${skipped.length} skipped — single-slot occupant${skipped.length === 1 ? '' : 's'} (${names})`,
          );
        }
        return { ok: true };
      } catch (err) {
        const error = errorMessage(err);
        log('error', `Remove ${deletable.join(', ')} failed: ${error}`);
        return { ok: false, error };
      }
    },

    moveComponentTo(id, containerId, index) {
      // canMoveTo is the shared validity gate (§5): refusals surface as a
      // logged reason + ActionResult error, never a throw — invalid drops
      // (own subtree, single-slot occupants, non-containers) change nothing.
      const verdict = canMoveTo(state.doc, id, containerId);
      if (!verdict.ok) {
        log('error', `Move ${id} refused: ${verdict.reason}`);
        return { ok: false, error: verdict.reason };
      }
      try {
        const doc = moveComponent(state.doc, id, containerId, index);
        // Same-position drops (the commitProp unchanged-value precedent):
        // nothing changed, so no undo snapshot and no re-render.
        if (JSON.stringify(doc.components) === JSON.stringify(state.doc.components)) {
          return { ok: true };
        }
        applyDoc(doc, `move ${id} → ${containerId}[${index}]`);
        return { ok: true };
      } catch (err) {
        const error = errorMessage(err);
        log('error', `Move ${id} failed: ${error}`);
        return { ok: false, error };
      }
    },

    selectComponent(id, opts) {
      if (id !== null && !state.doc.components.some((c) => c.id === id)) {
        return; // stale id (race with a re-render) — keep the current selection
      }
      // Plain select: REPLACE the whole list with [id] / [] (§4f) — this is
      // every single-select path (canvas tap, tree click, breadcrumb, ↑
      // parent, MOVE_START lift, tree drag start), so lifting or clicking
      // with a multi-selection collapses it to the pressed component.
      // Selecting a component brings the Design inspector forward; manual tab
      // clicks stick until the next selection. Deselecting leaves the tab.
      // On mobile the same selection also switches the single-column view to
      // Design (contract §7b) unless the caller opts out (MOVE_START must
      // keep the canvas visible for the in-flight §4e gesture).
      const autoView = opts?.autoView !== false;
      const ids = id !== null ? [id] : [];
      const patch: Partial<ComposerState> =
        id !== null
          ? {
              ...selectionPatch(ids),
              rightTab: 'design',
              ...(state.mobile && autoView ? { mobileView: 'design' as MobileView } : {}),
            }
          : selectionPatch(ids);
      set(patch);
      sendSelection(ids);
    },
    toggleSelected(id) {
      if (!state.doc.components.some((c) => c.id === id)) {
        return; // stale id — same guard as selectComponent
      }
      const current = state.selectedComponentIds;
      // Toggle out (removing the primary promotes the next id positionally;
      // removing the last id clears) or append at the end.
      const ids = current.includes(id) ? current.filter((x) => x !== id) : [...current, id];
      // A non-empty result brings the Design inspector forward (its
      // multi-state shows the growing selection); emptying the list is a
      // deselect and leaves the tab, like selectComponent(null). The mobile
      // view is deliberately never switched here — hiding the canvas after
      // each toggle would make building a multi-selection by long-press
      // impossible (contract §7b spirit, same as MOVE_START's autoView).
      set({
        ...selectionPatch(ids),
        ...(ids.length > 0 ? { rightTab: 'design' as RightTab } : {}),
      });
      sendSelection(ids);
    },
    setSelection(ids) {
      // Marquee replace (§4f): dedupe (first occurrence wins), filter to ids
      // present in the doc. [] clears. Same mobile-view reasoning as
      // toggleSelected — the marquee is a canvas gesture.
      const seen = new Set<string>();
      const next: string[] = [];
      for (const id of ids) {
        if (seen.has(id) || !state.doc.components.some((c) => c.id === id)) continue;
        seen.add(id);
        next.push(id);
      }
      set({
        ...selectionPatch(next),
        ...(next.length > 0 ? { rightTab: 'design' as RightTab } : {}),
      });
      sendSelection(next);
    },
    clearSelection() {
      set(selectionPatch([]));
      sendSelection([]);
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

    setMobile(mobile) {
      if (state.mobile !== mobile) set({ mobile });
    },
    setMobileView(view) {
      // The Design/Chat views ARE the right-sidebar tab contents shown
      // full-screen; keep rightTab in sync so the correct panel is visible
      // (both panels stay mounted, exactly as on desktop).
      const patch: Partial<ComposerState> = { mobileView: view };
      if (view === 'design' || view === 'chat') patch.rightTab = view;
      set(patch);
    },
    showToast(message) {
      const toast: ToastState = { id: ++toastId, message };
      if (toastTimer !== null) clearTimeout(toastTimer);
      set({ toast }); // one at a time: a new toast replaces the previous one
      toastTimer = setTimeout(() => {
        toastTimer = null;
        if (state.toast !== null && state.toast.id === toast.id) set({ toast: null });
      }, TOAST_DURATION_MS);
    },
    dismissToast() {
      if (toastTimer !== null) {
        clearTimeout(toastTimer);
        toastTimer = null;
      }
      if (state.toast !== null) set({ toast: null });
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
    attachCanvasDnd(surface) {
      canvasDnd = surface;
    },
    getCanvasDnd: () => canvasDnd,
    actions,
  };
}
