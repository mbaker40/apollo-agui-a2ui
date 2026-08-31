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

export interface SidecarReadyPayload {
  features: string[];
  version: number;
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
  onReady?(): void;
  onCatalog?(payload: CatalogHandshakePayload): void;
  onUsages?(payload: ComponentUsages): void;
  onDataModelChange?(payload: DataModelChangePayload): void;
  onSendToServer?(payload: SendToServerPayload): void;
  onConsoleLog?(payload: ConsoleLogPayload): void;
  onSurfaceResize?(payload: SurfaceResizePayload): void;
  onSidecarReady?(payload: SidecarReadyPayload): void;
  onDndTarget?(payload: DndTargetPayload): void;
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
  }
}
