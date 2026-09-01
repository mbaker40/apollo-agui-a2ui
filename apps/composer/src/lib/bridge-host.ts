/**
 * Framework-agnostic host side of the A2UI Preview Bridge (contract §2) plus
 * the COMPOSERX drag-and-drop sidecar vocabulary (contract §4).
 *
 * IMPORTANT: only the side-effect-free `a2ui-bridge` subpaths are imported
 * here — the package root and `/react` instantiate a renderer-side singleton
 * on window, which is the wrong side of the iframe.
 */
import { PreviewBridgeMessageType } from 'a2ui-bridge/messages';
import type {
  CatalogHandshakePayload,
  ConsoleLogPayload,
  DataModelChangePayload,
  RenderA2uiItem,
  SendToServerPayload,
  SurfaceResizePayload,
} from 'a2ui-bridge/messages';
import type { ComponentUsages } from 'a2ui-bridge/render-config';

export const COMPOSERX_SIDECAR_READY = 'COMPOSERX_SIDECAR_READY';
export const COMPOSERX_DND_HOVER = 'COMPOSERX_DND_HOVER';
export const COMPOSERX_DND_END = 'COMPOSERX_DND_END';
export const COMPOSERX_DND_TARGET = 'COMPOSERX_DND_TARGET';
export const COMPOSERX_SET_MODE = 'COMPOSERX_SET_MODE';
export const COMPOSERX_SET_SELECTION = 'COMPOSERX_SET_SELECTION';
export const COMPOSERX_SELECT = 'COMPOSERX_SELECT';
export const COMPOSERX_MARQUEE = 'COMPOSERX_MARQUEE';
export const COMPOSERX_PROP_SPECS = 'COMPOSERX_PROP_SPECS';
export const COMPOSERX_MOVE_START = 'COMPOSERX_MOVE_START';
export const COMPOSERX_MOVE_DROP = 'COMPOSERX_MOVE_DROP';
export const COMPOSERX_MOVE_CANCEL = 'COMPOSERX_MOVE_CANCEL';

/** Sidecar feature names (contract §4/§4c/§4d/§4e/§4f) — check the array, not the version. */
export const SIDECAR_FEATURE_DND = 'dnd-hittest';
export const SIDECAR_FEATURE_SELECT = 'select';
export const SIDECAR_FEATURE_PROP_SPECS = 'prop-specs';
export const SIDECAR_FEATURE_MOVE = 'move';
export const SIDECAR_FEATURE_MULTI_SELECT = 'multi-select';

export interface SidecarReadyPayload {
  features: string[];
  version: number;
}

/**
 * Tolerant read of SIDECAR_READY features: every feature is independently
 * optional, so v1 payloads (`['dnd-hittest'], version: 1`) and malformed
 * payloads both work — non-arrays yield no features, non-string entries are
 * dropped.
 */
export function parseSidecarFeatures(payload: unknown): string[] {
  if (!payload || typeof payload !== 'object') return [];
  const features = (payload as { features?: unknown }).features;
  if (!Array.isArray(features)) return [];
  return features.filter((f): f is string => typeof f === 'string');
}

export type ComposerMode = 'edit' | 'preview';

export interface SetModePayload {
  mode: ComposerMode;
}

export interface SelectionPayload {
  /** null = no selection (background click / deselect). */
  id: string | null;
  /**
   * COMPOSERX_SELECT only (§4f): true = additive toggle (shift-click, or a
   * ~350ms touch long-press). Absent/false = plain replace select. A v3
   * catalog never sends the field.
   */
  additive?: boolean;
}

/**
 * COMPOSERX_SET_SELECTION (composer → catalog): `id` stays the primary for
 * back-compat (a v3 catalog outlines just it); `ids` is the full ordered
 * selection list a v4 catalog multi-outlines (§4f).
 */
export interface SetSelectionPayload {
  id: string | null;
  ids?: string[];
}

/** COMPOSERX_MARQUEE (§4f): topmost-intersecting candidate ids ([] clears). */
export interface MarqueePayload {
  ids: string[];
}

/**
 * Shape check for COMPOSERX_SELECT payloads; null = malformed, drop it.
 * `id` must be a string or an explicit null (background tap). A non-boolean
 * `additive` is tolerated as "plain" rather than dropping the user's click —
 * the flag is an enhancement, not the message.
 */
export function parseSelectPayload(payload: unknown): SelectionPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const { id, additive } = payload as Record<string, unknown>;
  if (typeof id !== 'string' && id !== null) return null;
  return additive === true ? { id, additive: true } : { id };
}

/** Shape check for MARQUEE payloads (array of strings); null = malformed, drop it. */
export function parseMarqueePayload(payload: unknown): MarqueePayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const ids = (payload as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return null;
  if (!ids.every((entry): entry is string => typeof entry === 'string')) return null;
  return { ids };
}

/** One inspector-form prop derived catalog-side from the zod schemas (§4d). */
export interface PropSpec {
  name: string;
  kind: 'string' | 'number' | 'boolean' | 'enum' | 'json';
  options?: string[];
  required?: boolean;
  bindable?: boolean;
  containment?: boolean;
}

export type PropSpecsMap = Record<string, { props: PropSpec[] }>;

export interface PropSpecsPayload {
  components: PropSpecsMap;
}

/** COMPOSERX_MOVE_START / COMPOSERX_MOVE_CANCEL: the lifted component (§4e). */
export interface MoveIdPayload {
  id: string;
  /**
   * Group move (§4e, sidecar v5): the full lifted selection — sent ONLY when
   * a group lift happened (`id` stays the pressed grab handle). Absent on
   * single lifts and from pre-v5 catalogs.
   */
  ids?: string[];
}

/**
 * COMPOSERX_MOVE_DROP (§4e): where the catalog wants the component re-homed.
 * `index` is the position in `containerId`'s children AFTER the moved id is
 * removed — after ALL moved ids are removed when `ids` marks a group drop
 * (contract §5). The composer stays authoritative and validates via
 * canMoveTo / canMoveGroupTo before applying.
 */
export interface MoveDropPayload {
  id: string;
  containerId: string;
  index: number;
  slot: 'before' | 'after' | 'into';
  /** Group move (§4e): the lifted selection, present only on group drops. */
  ids?: string[];
}

/**
 * Tolerant read of the optional §4e group-move `ids`: a non-array yields
 * undefined (single-move semantics — the flag is an enhancement, not the
 * message), and malformed entries (non-strings, empty strings) are dropped
 * defensively rather than failing the whole payload.
 */
function parseMoveIds(payload: object): string[] | undefined {
  const ids = (payload as { ids?: unknown }).ids;
  if (!Array.isArray(ids)) return undefined;
  return ids.filter((entry): entry is string => typeof entry === 'string' && entry.length > 0);
}

/** Shape check for MOVE_START/MOVE_CANCEL payloads; null = malformed, drop it. */
export function parseMoveIdPayload(payload: unknown): MoveIdPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== 'string' || id.length === 0) return null;
  const ids = parseMoveIds(payload);
  return ids !== undefined ? { id, ids } : { id };
}

/** Shape check for MOVE_DROP payloads; null = malformed, drop it. */
export function parseMoveDropPayload(payload: unknown): MoveDropPayload | null {
  if (!payload || typeof payload !== 'object') return null;
  const { id, containerId, index, slot } = payload as Record<string, unknown>;
  if (typeof id !== 'string' || id.length === 0) return null;
  if (typeof containerId !== 'string' || containerId.length === 0) return null;
  if (typeof index !== 'number' || !Number.isFinite(index)) return null;
  if (slot !== 'before' && slot !== 'after' && slot !== 'into') return null;
  const ids = parseMoveIds(payload);
  return ids !== undefined
    ? { id, containerId, index, slot, ids }
    : { id, containerId, index, slot };
}

export interface DndHoverPayload {
  /** CSS pixels in the catalog iframe's viewport. */
  x: number;
  y: number;
}

export interface DndTargetPayload {
  targetId: string | null;
  containerId: string | null;
  index: number | null;
  slot: 'before' | 'after' | 'into' | null;
  rect: { x: number; y: number; width: number; height: number } | null;
}

export type BridgeTheme = 'light' | 'dark';

/** Structural iframe type so tests can drive the host with jsdom iframes. */
export interface IframeLike {
  contentWindow: Pick<Window, 'postMessage'> | null;
}

interface OutboundMessage {
  type: string;
  payload?: unknown;
}

export interface BridgeHostCallbacks {
  /** Current shell theme, read at handshake time. */
  getTheme(): BridgeTheme;
  /** Current doc serialized as RENDER_A2UI items, read at handshake time. */
  getRenderItems(): RenderA2uiItem[];
  /**
   * Current edit/preview mode, read at handshake time so mode survives a
   * renderer reload (re-sent after RENDER_A2UI). Optional: when absent no
   * SET_MODE is re-sent and the sidecar's default ('edit') applies.
   */
  getMode?(): ComposerMode;
  /** Current primary selection, read at handshake time (re-sent after RENDER_A2UI). */
  getSelection?(): string | null;
  /**
   * Current full selection list (§4f), read at handshake time. Optional and
   * only consulted when getSelection is also provided; when present the
   * re-sent SET_SELECTION carries `{id, ids}` so a v4 catalog re-anchors
   * every outline after a renderer reload.
   */
  getSelectionIds?(): string[];
  onReady?(): void;
  onCatalog?(payload: CatalogHandshakePayload): void;
  onUsages?(payload: ComponentUsages): void;
  onDataModelChange?(payload: DataModelChangePayload): void;
  onSendToServer?(payload: SendToServerPayload): void;
  onConsoleLog?(payload: ConsoleLogPayload): void;
  onSurfaceResize?(payload: SurfaceResizePayload): void;
  onSidecarReady?(payload: SidecarReadyPayload): void;
  onDndTarget?(payload: DndTargetPayload): void;
  /** COMPOSERX_SELECT from the sidecar: deepest hit id (+ additive flag, §4f), or null. */
  onSelect?(payload: SelectionPayload): void;
  /** COMPOSERX_MARQUEE from the sidecar (§4f): replace the selection with these ids. */
  onMarquee?(payload: MarqueePayload): void;
  /** COMPOSERX_PROP_SPECS from the sidecar (§4d). */
  onPropSpecs?(payload: PropSpecsPayload): void;
  /** COMPOSERX_MOVE_START (§4e): a canvas move gesture lifted this component. */
  onMoveStart?(payload: MoveIdPayload): void;
  /** COMPOSERX_MOVE_DROP (§4e): the catalog proposes a re-home; validate then apply. */
  onMoveDrop?(payload: MoveDropPayload): void;
  /** COMPOSERX_MOVE_CANCEL (§4e): the gesture ended without a drop. */
  onMoveCancel?(payload: MoveIdPayload): void;
  /** Anything not recognized above (including FORCE_UNBLOCK) — for the event log. */
  onUnknown?(type: string, payload: unknown): void;
}

/**
 * One BridgeHost per iframe mount. Lifecycle:
 *   const host = new BridgeHost(callbacks);
 *   host.register(iframe, rendererUrl);  // starts listening
 *   ...
 *   host.dispose();                      // stops listening, drops the queue
 *
 * Origin rules (contract §2): a message is accepted only when
 * `event.source === iframe.contentWindow` AND `event.origin` equals the origin
 * of the resolved renderer URL; every outgoing postMessage targets that exact
 * origin (never '*'). Outbound messages are queued until RENDERER_READY; on
 * ready the handshake runs SET_THEME → GET_CATALOG → GET_COMPONENT_USAGES,
 * the queue flushes, then RENDER_A2UI carries the current doc.
 */
export class BridgeHost {
  private iframe: IframeLike | null = null;
  private rendererOrigin: string | null = null;
  private ready = false;
  private listening = false;
  private disposed = false;
  private queue: OutboundMessage[] = [];

  constructor(private readonly callbacks: BridgeHostCallbacks) {}

  get isReady(): boolean {
    return this.ready;
  }

  register(iframe: IframeLike, rendererUrl: string): void {
    if (this.disposed) throw new Error('BridgeHost has been disposed');
    this.iframe = iframe;
    this.rendererOrigin = new URL(rendererUrl, window.location.href).origin;
    this.ready = false;
    this.queue = [];
    if (!this.listening) {
      window.addEventListener('message', this.onMessage);
      this.listening = true;
    }
  }

  dispose(): void {
    if (this.listening) {
      window.removeEventListener('message', this.onMessage);
      this.listening = false;
    }
    this.disposed = true;
    this.iframe = null;
    this.rendererOrigin = null;
    this.ready = false;
    this.queue = [];
  }

  sendRender(items: RenderA2uiItem[]): void {
    this.send({ type: PreviewBridgeMessageType.RENDER_A2UI, payload: items });
  }

  sendTheme(theme: BridgeTheme): void {
    this.send({ type: PreviewBridgeMessageType.SET_THEME, payload: { theme } });
  }

  /** Queued like other non-DND messages until the renderer is ready (§4c). */
  sendSetMode(payload: SetModePayload): void {
    this.send({ type: COMPOSERX_SET_MODE, payload });
  }

  /** Queued like other non-DND messages until the renderer is ready (§4c/§4f). */
  sendSetSelection(payload: SetSelectionPayload): void {
    this.send({ type: COMPOSERX_SET_SELECTION, payload });
  }

  /** DnD messages are ephemeral: dropped (not queued) until the renderer is ready. */
  sendDndHover(point: DndHoverPayload): void {
    if (!this.ready) return;
    this.post({ type: COMPOSERX_DND_HOVER, payload: point });
  }

  sendDndEnd(): void {
    if (!this.ready) return;
    this.post({ type: COMPOSERX_DND_END });
  }

  private send(message: OutboundMessage): void {
    if (this.disposed) return;
    if (!this.ready) {
      this.queue.push(message);
      return;
    }
    this.post(message);
  }

  private post(message: OutboundMessage): void {
    const target = this.iframe?.contentWindow;
    if (!target || !this.rendererOrigin) return;
    target.postMessage(message, this.rendererOrigin);
  }

  private readonly onMessage = (event: MessageEvent): void => {
    if (this.disposed || !this.iframe || !this.rendererOrigin) return;
    if (event.source !== this.iframe.contentWindow) return;
    if (event.origin !== this.rendererOrigin) return;
    const data: unknown = event.data;
    if (!data || typeof data !== 'object') return;
    const type = (data as { type?: unknown }).type;
    if (typeof type !== 'string') return;
    const payload = (data as { payload?: unknown }).payload;

    switch (type) {
      case PreviewBridgeMessageType.RENDERER_READY:
        this.handleReady();
        break;
      case PreviewBridgeMessageType.A2UI_CATALOG:
        this.callbacks.onCatalog?.(payload as CatalogHandshakePayload);
        break;
      case PreviewBridgeMessageType.COMPONENT_USAGES:
        this.callbacks.onUsages?.(payload as ComponentUsages);
        break;
      case PreviewBridgeMessageType.DATA_MODEL_CHANGE:
        this.callbacks.onDataModelChange?.(payload as DataModelChangePayload);
        break;
      case PreviewBridgeMessageType.SEND_TO_SERVER:
        this.callbacks.onSendToServer?.(payload as SendToServerPayload);
        break;
      case PreviewBridgeMessageType.CONSOLE_LOG:
        this.callbacks.onConsoleLog?.(payload as ConsoleLogPayload);
        break;
      case PreviewBridgeMessageType.SURFACE_RESIZE:
        this.callbacks.onSurfaceResize?.(payload as SurfaceResizePayload);
        break;
      case COMPOSERX_SIDECAR_READY:
        this.callbacks.onSidecarReady?.(payload as SidecarReadyPayload);
        break;
      case COMPOSERX_DND_TARGET:
        this.callbacks.onDndTarget?.(payload as DndTargetPayload);
        break;
      // SELECT/MARQUEE drive the selection list (§4f), so like MOVE_* they
      // are shape-checked here; malformed payloads are dropped silently.
      case COMPOSERX_SELECT: {
        const select = parseSelectPayload(payload);
        if (select) this.callbacks.onSelect?.(select);
        break;
      }
      case COMPOSERX_MARQUEE: {
        const marquee = parseMarqueePayload(payload);
        if (marquee) this.callbacks.onMarquee?.(marquee);
        break;
      }
      case COMPOSERX_PROP_SPECS:
        this.callbacks.onPropSpecs?.(payload as PropSpecsPayload);
        break;
      // MOVE_* payloads drive document mutations, so unlike the display-only
      // messages above they are shape-checked here; malformed ones are dropped.
      case COMPOSERX_MOVE_START: {
        const start = parseMoveIdPayload(payload);
        if (start) this.callbacks.onMoveStart?.(start);
        break;
      }
      case COMPOSERX_MOVE_DROP: {
        const drop = parseMoveDropPayload(payload);
        if (drop) this.callbacks.onMoveDrop?.(drop);
        break;
      }
      case COMPOSERX_MOVE_CANCEL: {
        const cancel = parseMoveIdPayload(payload);
        if (cancel) this.callbacks.onMoveCancel?.(cancel);
        break;
      }
      default:
        this.callbacks.onUnknown?.(type, payload);
        break;
    }
  };

  private handleReady(): void {
    this.ready = true;
    this.callbacks.onReady?.();
    this.post({
      type: PreviewBridgeMessageType.SET_THEME,
      payload: { theme: this.callbacks.getTheme() },
    });
    this.post({ type: PreviewBridgeMessageType.GET_CATALOG });
    this.post({ type: PreviewBridgeMessageType.GET_COMPONENT_USAGES });
    const pending = this.queue;
    this.queue = [];
    for (const message of pending) {
      this.post(message);
    }
    this.post({
      type: PreviewBridgeMessageType.RENDER_A2UI,
      payload: this.callbacks.getRenderItems(),
    });
    // Mode and selection survive a renderer reload: re-send both after
    // RENDER_A2UI so the sidecar can re-anchor its outlines (§4c).
    if (this.callbacks.getMode) {
      this.post({ type: COMPOSERX_SET_MODE, payload: { mode: this.callbacks.getMode() } });
    }
    if (this.callbacks.getSelection) {
      const id = this.callbacks.getSelection();
      const ids = this.callbacks.getSelectionIds?.();
      this.post({
        type: COMPOSERX_SET_SELECTION,
        payload: ids !== undefined ? { id, ids } : { id },
      });
    }
  }
}
