import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewBridgeMessageType } from 'a2ui-bridge/messages';
import type { RenderA2uiItem } from 'a2ui-bridge/messages';
import type { BridgeHostCallbacks } from '../src/lib/bridge-host';
import {
  BridgeHost,
  COMPOSERX_DND_HOVER,
  COMPOSERX_DND_TARGET,
  COMPOSERX_SIDECAR_READY,
} from '../src/lib/bridge-host';

const RENDERER_URL = 'http://localhost:7465/';
const RENDERER_ORIGIN = 'http://localhost:7465';

interface Sent {
  message: { type: string; payload?: unknown };
  targetOrigin: string;
}

interface Harness {
  host: BridgeHost;
  iframe: HTMLIFrameElement;
  sent: Sent[];
  callbacks: {
    onReady: ReturnType<typeof vi.fn>;
    onCatalog: ReturnType<typeof vi.fn>;
    onUsages: ReturnType<typeof vi.fn>;
    onDataModelChange: ReturnType<typeof vi.fn>;
    onSendToServer: ReturnType<typeof vi.fn>;
    onConsoleLog: ReturnType<typeof vi.fn>;
    onSurfaceResize: ReturnType<typeof vi.fn>;
    onSidecarReady: ReturnType<typeof vi.fn>;
    onDndTarget: ReturnType<typeof vi.fn>;
    onUnknown: ReturnType<typeof vi.fn>;
  };
  dispatch(
    type: string,
    payload?: unknown,
    overrides?: { origin?: string; source?: unknown },
  ): void;
}

const renderItems: RenderA2uiItem[] = [
  { version: 'v0.9', createSurface: { surfaceId: 'composer-canvas', catalogId: 'urn:x' } },
];

let harnesses: Harness[] = [];

function makeHarness(overrides: Partial<BridgeHostCallbacks> = {}): Harness {
  const iframe = document.createElement('iframe');
  document.body.appendChild(iframe);
  const sent: Sent[] = [];
  const contentWindow = iframe.contentWindow;
  if (!contentWindow) throw new Error('jsdom iframe has no contentWindow');
  contentWindow.postMessage = ((message: unknown, targetOrigin: string) => {
    sent.push({ message: message as Sent['message'], targetOrigin });
  }) as typeof contentWindow.postMessage;

  const callbacks = {
    onReady: vi.fn(),
    onCatalog: vi.fn(),
    onUsages: vi.fn(),
    onDataModelChange: vi.fn(),
    onSendToServer: vi.fn(),
    onConsoleLog: vi.fn(),
    onSurfaceResize: vi.fn(),
    onSidecarReady: vi.fn(),
    onDndTarget: vi.fn(),
    onUnknown: vi.fn(),
  };
  const host = new BridgeHost({
    getTheme: () => 'dark',
    getRenderItems: () => renderItems,
    ...callbacks,
    ...overrides,
  });
  host.register(iframe, RENDERER_URL);

  const harness: Harness = {
    host,
    iframe,
    sent,
    callbacks,
    dispatch(type, payload, dispatchOverrides = {}) {
      const event = new MessageEvent('message', {
        data: payload === undefined ? { type } : { type, payload },
        origin: dispatchOverrides.origin ?? RENDERER_ORIGIN,
        source: (dispatchOverrides.source ?? iframe.contentWindow) as MessageEventSource,
      });
      window.dispatchEvent(event);
    },
  };
  harnesses.push(harness);
  return harness;
}

beforeEach(() => {
  harnesses = [];
});

afterEach(() => {
  for (const h of harnesses) {
    h.host.dispose();
    h.iframe.remove();
  }
});

describe('BridgeHost origin/source filtering', () => {
  it('drops messages from the wrong origin', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY, undefined, {
      origin: 'http://evil.example',
    });
    expect(h.callbacks.onReady).not.toHaveBeenCalled();
    expect(h.host.isReady).toBe(false);
  });

  it('drops messages whose source is not the registered iframe contentWindow', () => {
    const h = makeHarness();
    const stranger = document.createElement('iframe');
    document.body.appendChild(stranger);
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY, undefined, {
      source: stranger.contentWindow,
    });
    expect(h.callbacks.onReady).not.toHaveBeenCalled();
    stranger.remove();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    expect(h.callbacks.onReady).toHaveBeenCalledTimes(1);
  });

  it('resolves relative renderer URLs against the window location', () => {
    const iframe = document.createElement('iframe');
    document.body.appendChild(iframe);
    const contentWindow = iframe.contentWindow;
    if (!contentWindow) throw new Error('jsdom iframe has no contentWindow');
    const host = new BridgeHost({ getTheme: () => 'light', getRenderItems: () => [] });
    host.register(iframe, 'catalog/');
    const sent: Sent[] = [];
    contentWindow.postMessage = ((message: unknown, targetOrigin: string) => {
      sent.push({ message: message as Sent['message'], targetOrigin });
    }) as typeof contentWindow.postMessage;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { type: PreviewBridgeMessageType.RENDERER_READY },
        origin: window.location.origin,
        source: contentWindow as MessageEventSource,
      }),
    );
    expect(host.isReady).toBe(true);
    expect(sent.every((s) => s.targetOrigin === window.location.origin)).toBe(true);
    host.dispose();
    iframe.remove();
  });
});

describe('BridgeHost buffering and handshake', () => {
  it('queues outbound messages until RENDERER_READY, then handshakes in order', () => {
    const h = makeHarness();
    h.host.sendRender([{ version: 'v0.9' }]);
    h.host.sendTheme('light');
    expect(h.sent).toHaveLength(0); // buffered

    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    const types = h.sent.map((s) => s.message.type);
    expect(types).toEqual([
      PreviewBridgeMessageType.SET_THEME,
      PreviewBridgeMessageType.GET_CATALOG,
      PreviewBridgeMessageType.GET_COMPONENT_USAGES,
      PreviewBridgeMessageType.RENDER_A2UI, // flushed queue entry
      PreviewBridgeMessageType.SET_THEME, // flushed queue entry
      PreviewBridgeMessageType.RENDER_A2UI, // current doc, last
    ]);
    expect(h.sent[0]!.message.payload).toEqual({ theme: 'dark' });
    expect(h.sent.at(-1)!.message.payload).toBe(renderItems);
    expect(h.callbacks.onReady).toHaveBeenCalledTimes(1);
  });

  it('posts every outgoing message with the renderer origin, never *', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.host.sendRender(renderItems);
    h.host.sendDndHover({ x: 3, y: 4 });
    h.host.sendDndEnd();
    expect(h.sent.length).toBeGreaterThan(0);
    for (const s of h.sent) {
      expect(s.targetOrigin).toBe(RENDERER_ORIGIN);
    }
  });

  it('sends immediately once ready and drops pre-ready DnD messages', () => {
    const h = makeHarness();
    h.host.sendDndHover({ x: 1, y: 2 });
    h.host.sendDndEnd();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    const preReadyDnd = h.sent.filter((s) => s.message.type.startsWith('COMPOSERX_'));
    expect(preReadyDnd).toHaveLength(0);
    h.host.sendDndHover({ x: 5, y: 6 });
    expect(h.sent.at(-1)!.message).toEqual({
      type: COMPOSERX_DND_HOVER,
      payload: { x: 5, y: 6 },
    });
  });
});

describe('BridgeHost message routing', () => {
  it('routes bridge and COMPOSERX messages to the right callbacks', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.dispatch(PreviewBridgeMessageType.A2UI_CATALOG, { title: 'Basic Catalog' });
    h.dispatch(PreviewBridgeMessageType.COMPONENT_USAGES, { Text: { usage: [] } });
    h.dispatch(PreviewBridgeMessageType.DATA_MODEL_CHANGE, {
      updateDataModel: { surfaceId: 's', value: { a: 1 } },
    });
    h.dispatch(PreviewBridgeMessageType.SEND_TO_SERVER, { version: 'v0.9', action: {} });
    h.dispatch(PreviewBridgeMessageType.CONSOLE_LOG, { level: 'warn', message: 'hi' });
    h.dispatch(PreviewBridgeMessageType.SURFACE_RESIZE, { height: 480 });
    h.dispatch(COMPOSERX_SIDECAR_READY, { features: ['dnd-hittest'], version: 1 });
    h.dispatch(COMPOSERX_DND_TARGET, {
      targetId: 'a',
      containerId: 'root',
      index: 0,
      slot: 'into',
      rect: null,
    });
    h.dispatch('SOME_FUTURE_TYPE', { x: 1 });

    expect(h.callbacks.onCatalog).toHaveBeenCalledWith({ title: 'Basic Catalog' });
    expect(h.callbacks.onUsages).toHaveBeenCalledWith({ Text: { usage: [] } });
    expect(h.callbacks.onDataModelChange).toHaveBeenCalledWith({
      updateDataModel: { surfaceId: 's', value: { a: 1 } },
    });
    expect(h.callbacks.onSendToServer).toHaveBeenCalledWith({ version: 'v0.9', action: {} });
    expect(h.callbacks.onConsoleLog).toHaveBeenCalledWith({ level: 'warn', message: 'hi' });
    expect(h.callbacks.onSurfaceResize).toHaveBeenCalledWith({ height: 480 });
    expect(h.callbacks.onSidecarReady).toHaveBeenCalledWith({
      features: ['dnd-hittest'],
      version: 1,
    });
    expect(h.callbacks.onDndTarget).toHaveBeenCalledWith(
      expect.objectContaining({ containerId: 'root', index: 0, slot: 'into' }),
    );
    expect(h.callbacks.onUnknown).toHaveBeenCalledWith('SOME_FUTURE_TYPE', { x: 1 });
  });

  it('ignores malformed message data', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    const before = h.sent.length;
    window.dispatchEvent(
      new MessageEvent('message', {
        data: 'not-an-object',
        origin: RENDERER_ORIGIN,
        source: h.iframe.contentWindow as MessageEventSource,
      }),
    );
    window.dispatchEvent(
      new MessageEvent('message', {
        data: { noType: true },
        origin: RENDERER_ORIGIN,
        source: h.iframe.contentWindow as MessageEventSource,
      }),
    );
    expect(h.sent).toHaveLength(before);
    expect(h.callbacks.onUnknown).not.toHaveBeenCalled();
  });

  it('re-runs the handshake if the renderer reloads and announces again', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    const first = h.sent.length;
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    expect(h.sent.length).toBeGreaterThan(first);
    expect(h.sent.at(-1)!.message.type).toBe(PreviewBridgeMessageType.RENDER_A2UI);
  });
});

describe('BridgeHost dispose', () => {
  it('stops listening and sending after dispose', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    const before = h.sent.length;
    h.host.dispose();
    h.dispatch(PreviewBridgeMessageType.A2UI_CATALOG, {});
    h.host.sendRender(renderItems);
    expect(h.callbacks.onCatalog).not.toHaveBeenCalled();
    expect(h.sent).toHaveLength(before);
  });
});
