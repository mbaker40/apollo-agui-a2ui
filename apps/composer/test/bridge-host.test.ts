import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { PreviewBridgeMessageType } from 'a2ui-bridge/messages';
import type { RenderA2uiItem } from 'a2ui-bridge/messages';
import type { BridgeHostCallbacks } from '../src/lib/bridge-host';
import {
  BridgeHost,
  COMPOSERX_DND_HOVER,
  COMPOSERX_DND_TARGET,
  COMPOSERX_MARQUEE,
  COMPOSERX_MOVE_CANCEL,
  COMPOSERX_MOVE_DROP,
  COMPOSERX_MOVE_START,
  COMPOSERX_PROP_SPECS,
  COMPOSERX_SELECT,
  COMPOSERX_SET_MODE,
  COMPOSERX_SET_SELECTION,
  COMPOSERX_SIDECAR_READY,
  parseMarqueePayload,
  parseMoveDropPayload,
  parseMoveIdPayload,
  parseSelectPayload,
  parseSidecarFeatures,
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
    onSelect: ReturnType<typeof vi.fn>;
    onMarquee: ReturnType<typeof vi.fn>;
    onPropSpecs: ReturnType<typeof vi.fn>;
    onMoveStart: ReturnType<typeof vi.fn>;
    onMoveDrop: ReturnType<typeof vi.fn>;
    onMoveCancel: ReturnType<typeof vi.fn>;
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
    onSelect: vi.fn(),
    onMarquee: vi.fn(),
    onPropSpecs: vi.fn(),
    onMoveStart: vi.fn(),
    onMoveDrop: vi.fn(),
    onMoveCancel: vi.fn(),
    onUnknown: vi.fn(),
  };
  const host = new BridgeHost({
    getTheme: () => 'dark',
    getRenderItems: () => renderItems,
    getMode: () => 'edit',
    getSelection: () => 'sel-1',
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
      PreviewBridgeMessageType.RENDER_A2UI, // current doc
      COMPOSERX_SET_MODE, // mode survives a renderer reload (§4c)
      COMPOSERX_SET_SELECTION, // so does the selection
    ]);
    expect(h.sent[0]!.message.payload).toEqual({ theme: 'dark' });
    expect(h.sent[5]!.message.payload).toBe(renderItems);
    expect(h.sent[6]!.message.payload).toEqual({ mode: 'edit' });
    expect(h.sent[7]!.message.payload).toEqual({ id: 'sel-1' });
    expect(h.callbacks.onReady).toHaveBeenCalledTimes(1);
  });

  it('re-sends mode and selection after RENDER_A2UI on every re-handshake', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.sent.length = 0;
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY); // renderer reloaded
    const types = h.sent.map((s) => s.message.type);
    const renderIdx = types.indexOf(PreviewBridgeMessageType.RENDER_A2UI);
    expect(renderIdx).toBeGreaterThanOrEqual(0);
    expect(types.slice(renderIdx + 1)).toEqual([COMPOSERX_SET_MODE, COMPOSERX_SET_SELECTION]);
  });

  it('skips the mode/selection re-send when the getters are not provided', () => {
    const h = makeHarness({ getMode: undefined, getSelection: undefined });
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    const types = h.sent.map((s) => s.message.type);
    expect(types).not.toContain(COMPOSERX_SET_MODE);
    expect(types).not.toContain(COMPOSERX_SET_SELECTION);
  });

  it('re-sends {id, ids} on handshake when getSelectionIds is provided (§4f)', () => {
    const h = makeHarness({ getSelectionIds: () => ['sel-1', 'sel-2'] });
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    const setSelection = h.sent.filter((s) => s.message.type === COMPOSERX_SET_SELECTION);
    expect(setSelection).toHaveLength(1);
    expect(setSelection[0]!.message.payload).toEqual({
      id: 'sel-1',
      ids: ['sel-1', 'sel-2'],
    });
  });

  it('sendSetSelection forwards the full {id, ids} payload', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.sent.length = 0;
    h.host.sendSetSelection({ id: 'a', ids: ['a', 'b'] });
    expect(h.sent.map((s) => s.message)).toEqual([
      { type: COMPOSERX_SET_SELECTION, payload: { id: 'a', ids: ['a', 'b'] } },
    ]);
  });

  it('queues sendSetMode / sendSetSelection until ready, then sends immediately', () => {
    const h = makeHarness();
    h.host.sendSetMode({ mode: 'preview' });
    h.host.sendSetSelection({ id: 'abc' });
    expect(h.sent).toHaveLength(0); // queued, not dropped (unlike DnD)

    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    const queued = h.sent.filter(
      (s) => s.message.type === COMPOSERX_SET_MODE || s.message.type === COMPOSERX_SET_SELECTION,
    );
    // the two queued messages flush, then the post-render re-send appends two more
    expect(queued.map((s) => s.message.payload)).toEqual([
      { mode: 'preview' },
      { id: 'abc' },
      { mode: 'edit' },
      { id: 'sel-1' },
    ]);

    h.sent.length = 0;
    h.host.sendSetSelection({ id: null });
    h.host.sendSetMode({ mode: 'edit' });
    expect(h.sent.map((s) => s.message)).toEqual([
      { type: COMPOSERX_SET_SELECTION, payload: { id: null } },
      { type: COMPOSERX_SET_MODE, payload: { mode: 'edit' } },
    ]);
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
    const preReadyDnd = h.sent.filter(
      (s) => s.message.type === COMPOSERX_DND_HOVER || s.message.type === 'COMPOSERX_DND_END',
    );
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
    h.dispatch(COMPOSERX_SELECT, { id: 'clicked-component' });
    h.dispatch(COMPOSERX_SELECT, { id: null });
    h.dispatch(COMPOSERX_PROP_SPECS, {
      components: { Text: { props: [{ name: 'text', kind: 'string' }] } },
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
    expect(h.callbacks.onSelect).toHaveBeenNthCalledWith(1, { id: 'clicked-component' });
    expect(h.callbacks.onSelect).toHaveBeenNthCalledWith(2, { id: null });
    expect(h.callbacks.onPropSpecs).toHaveBeenCalledWith({
      components: { Text: { props: [{ name: 'text', kind: 'string' }] } },
    });
    expect(h.callbacks.onUnknown).toHaveBeenCalledWith('SOME_FUTURE_TYPE', { x: 1 });
    expect(h.callbacks.onUnknown).not.toHaveBeenCalledWith(COMPOSERX_SELECT, expect.anything());
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
    const reHandshake = h.sent.slice(first).map((s) => s.message.type);
    expect(reHandshake).toContain(PreviewBridgeMessageType.RENDER_A2UI);
    // the doc render still precedes the mode/selection re-send
    expect(reHandshake.at(-3)).toBe(PreviewBridgeMessageType.RENDER_A2UI);
  });
});

describe('BridgeHost MOVE_* routing (§4e)', () => {
  it('routes MOVE_START / MOVE_DROP / MOVE_CANCEL to the move callbacks', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.dispatch(COMPOSERX_MOVE_START, { id: 'welcome-card' });
    h.dispatch(COMPOSERX_MOVE_DROP, {
      id: 'welcome-card',
      containerId: 'root',
      index: 1,
      slot: 'after',
    });
    h.dispatch(COMPOSERX_MOVE_CANCEL, { id: 'welcome-card' });

    expect(h.callbacks.onMoveStart).toHaveBeenCalledWith({ id: 'welcome-card' });
    expect(h.callbacks.onMoveDrop).toHaveBeenCalledWith({
      id: 'welcome-card',
      containerId: 'root',
      index: 1,
      slot: 'after',
    });
    expect(h.callbacks.onMoveCancel).toHaveBeenCalledWith({ id: 'welcome-card' });
    expect(h.callbacks.onUnknown).not.toHaveBeenCalled();
  });

  it('index 0 and slot into/before survive the shape check', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.dispatch(COMPOSERX_MOVE_DROP, { id: 'a', containerId: 'b', index: 0, slot: 'into' });
    h.dispatch(COMPOSERX_MOVE_DROP, { id: 'a', containerId: 'b', index: 2, slot: 'before' });
    expect(h.callbacks.onMoveDrop).toHaveBeenCalledTimes(2);
  });

  it('passes the optional group-move ids through MOVE_START and MOVE_DROP (§4e group move)', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.dispatch(COMPOSERX_MOVE_START, { id: 'a', ids: ['a', 'b'] });
    h.dispatch(COMPOSERX_MOVE_DROP, {
      id: 'a',
      containerId: 'root',
      index: 1,
      slot: 'after',
      ids: ['a', 'b'],
    });
    expect(h.callbacks.onMoveStart).toHaveBeenCalledWith({ id: 'a', ids: ['a', 'b'] });
    expect(h.callbacks.onMoveDrop).toHaveBeenCalledWith({
      id: 'a',
      containerId: 'root',
      index: 1,
      slot: 'after',
      ids: ['a', 'b'],
    });
    expect(h.callbacks.onUnknown).not.toHaveBeenCalled();
  });

  it('drops malformed MOVE_* payloads without invoking callbacks (or onUnknown)', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.dispatch(COMPOSERX_MOVE_START); // no payload
    h.dispatch(COMPOSERX_MOVE_START, { id: 42 });
    h.dispatch(COMPOSERX_MOVE_START, { id: '' });
    h.dispatch(COMPOSERX_MOVE_START, 'welcome-card');
    h.dispatch(COMPOSERX_MOVE_CANCEL, {});
    h.dispatch(COMPOSERX_MOVE_CANCEL, { id: null });
    h.dispatch(COMPOSERX_MOVE_DROP, { id: 'a', containerId: 'b', slot: 'after' }); // no index
    h.dispatch(COMPOSERX_MOVE_DROP, { id: 'a', containerId: 'b', index: '1', slot: 'after' });
    h.dispatch(COMPOSERX_MOVE_DROP, { id: 'a', containerId: 'b', index: Number.NaN, slot: 'into' });
    h.dispatch(COMPOSERX_MOVE_DROP, { id: 'a', containerId: 'b', index: 1, slot: 'inside' });
    h.dispatch(COMPOSERX_MOVE_DROP, { id: 'a', index: 1, slot: 'after' }); // no containerId
    h.dispatch(COMPOSERX_MOVE_DROP, null);

    expect(h.callbacks.onMoveStart).not.toHaveBeenCalled();
    expect(h.callbacks.onMoveDrop).not.toHaveBeenCalled();
    expect(h.callbacks.onMoveCancel).not.toHaveBeenCalled();
    expect(h.callbacks.onUnknown).not.toHaveBeenCalled();
  });
});

describe('BridgeHost SELECT/MARQUEE routing (§4f)', () => {
  it('forwards the additive flag on SELECT', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.dispatch(COMPOSERX_SELECT, { id: 'hit', additive: true });
    h.dispatch(COMPOSERX_SELECT, { id: 'hit', additive: false });
    h.dispatch(COMPOSERX_SELECT, { id: 'hit' });
    expect(h.callbacks.onSelect).toHaveBeenNthCalledWith(1, { id: 'hit', additive: true });
    expect(h.callbacks.onSelect).toHaveBeenNthCalledWith(2, { id: 'hit' }); // false → plain
    expect(h.callbacks.onSelect).toHaveBeenNthCalledWith(3, { id: 'hit' });
  });

  it('tolerates a non-boolean additive as a plain select (the click survives)', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.dispatch(COMPOSERX_SELECT, { id: 'hit', additive: 'yes' });
    expect(h.callbacks.onSelect).toHaveBeenCalledWith({ id: 'hit' });
  });

  it('drops malformed SELECT payloads without invoking callbacks (or onUnknown)', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.dispatch(COMPOSERX_SELECT); // no payload
    h.dispatch(COMPOSERX_SELECT, 'hit');
    h.dispatch(COMPOSERX_SELECT, { id: 42 });
    h.dispatch(COMPOSERX_SELECT, {}); // id missing entirely (null must be explicit)
    expect(h.callbacks.onSelect).not.toHaveBeenCalled();
    expect(h.callbacks.onUnknown).not.toHaveBeenCalled();
  });

  it('routes MARQUEE ids to onMarquee — the empty sweep included', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.dispatch(COMPOSERX_MARQUEE, { ids: ['a', 'b'] });
    h.dispatch(COMPOSERX_MARQUEE, { ids: [] });
    expect(h.callbacks.onMarquee).toHaveBeenNthCalledWith(1, { ids: ['a', 'b'] });
    expect(h.callbacks.onMarquee).toHaveBeenNthCalledWith(2, { ids: [] });
    expect(h.callbacks.onUnknown).not.toHaveBeenCalled();
  });

  it('drops malformed MARQUEE payloads without invoking callbacks (or onUnknown)', () => {
    const h = makeHarness();
    h.dispatch(PreviewBridgeMessageType.RENDERER_READY);
    h.dispatch(COMPOSERX_MARQUEE); // no payload
    h.dispatch(COMPOSERX_MARQUEE, { ids: 'a' });
    h.dispatch(COMPOSERX_MARQUEE, { ids: ['a', 5] });
    h.dispatch(COMPOSERX_MARQUEE, { ids: [null] });
    h.dispatch(COMPOSERX_MARQUEE, {});
    h.dispatch(COMPOSERX_MARQUEE, ['a']);
    expect(h.callbacks.onMarquee).not.toHaveBeenCalled();
    expect(h.callbacks.onUnknown).not.toHaveBeenCalled();
  });
});

describe('parseSelectPayload / parseMarqueePayload', () => {
  it('accepts well-formed SELECT payloads (null id = background)', () => {
    expect(parseSelectPayload({ id: 'x' })).toEqual({ id: 'x' });
    expect(parseSelectPayload({ id: null })).toEqual({ id: null });
    expect(parseSelectPayload({ id: 'x', additive: true })).toEqual({ id: 'x', additive: true });
    expect(parseSelectPayload({ id: null, additive: true })).toEqual({
      id: null,
      additive: true,
    });
  });

  it('downgrades non-true additive and rejects malformed SELECT payloads', () => {
    expect(parseSelectPayload({ id: 'x', additive: false })).toEqual({ id: 'x' });
    expect(parseSelectPayload({ id: 'x', additive: 1 })).toEqual({ id: 'x' });
    expect(parseSelectPayload(undefined)).toBeNull();
    expect(parseSelectPayload('x')).toBeNull();
    expect(parseSelectPayload({})).toBeNull();
    expect(parseSelectPayload({ id: 7 })).toBeNull();
  });

  it('accepts string-array MARQUEE payloads and rejects the rest', () => {
    expect(parseMarqueePayload({ ids: [] })).toEqual({ ids: [] });
    expect(parseMarqueePayload({ ids: ['a'] })).toEqual({ ids: ['a'] });
    expect(parseMarqueePayload({ ids: ['a', ''] })).toEqual({ ids: ['a', ''] });
    expect(parseMarqueePayload(null)).toBeNull();
    expect(parseMarqueePayload({})).toBeNull();
    expect(parseMarqueePayload({ ids: 'a' })).toBeNull();
    expect(parseMarqueePayload({ ids: ['a', 2] })).toBeNull();
    expect(parseMarqueePayload({ ids: [undefined] })).toBeNull();
  });
});

describe('parseMoveIdPayload / parseMoveDropPayload', () => {
  it('accepts well-formed payloads', () => {
    expect(parseMoveIdPayload({ id: 'x' })).toEqual({ id: 'x' });
    expect(parseMoveDropPayload({ id: 'x', containerId: 'y', index: 3, slot: 'before' })).toEqual({
      id: 'x',
      containerId: 'y',
      index: 3,
      slot: 'before',
    });
  });

  it('strips extra fields from MOVE_DROP payloads', () => {
    expect(
      parseMoveDropPayload({ id: 'x', containerId: 'y', index: 0, slot: 'into', extra: true }),
    ).toEqual({ id: 'x', containerId: 'y', index: 0, slot: 'into' });
  });

  it('rejects malformed payloads with null', () => {
    expect(parseMoveIdPayload(undefined)).toBeNull();
    expect(parseMoveIdPayload('x')).toBeNull();
    expect(parseMoveIdPayload({ id: '' })).toBeNull();
    expect(parseMoveDropPayload({ id: 'x', containerId: '', index: 0, slot: 'into' })).toBeNull();
    expect(
      parseMoveDropPayload({ id: 'x', containerId: 'y', index: Infinity, slot: 'into' }),
    ).toBeNull();
    expect(parseMoveDropPayload({ id: 'x', containerId: 'y', index: 0, slot: null })).toBeNull();
  });

  it('accepts the optional group-move ids, filtering malformed entries defensively (§4e)', () => {
    expect(parseMoveIdPayload({ id: 'x', ids: ['a', 'b'] })).toEqual({ id: 'x', ids: ['a', 'b'] });
    expect(parseMoveIdPayload({ id: 'x', ids: ['a', 5, '', null, 'b'] })).toEqual({
      id: 'x',
      ids: ['a', 'b'],
    });
    expect(
      parseMoveDropPayload({ id: 'x', containerId: 'y', index: 0, slot: 'into', ids: ['x', 'z'] }),
    ).toEqual({ id: 'x', containerId: 'y', index: 0, slot: 'into', ids: ['x', 'z'] });
    // an all-malformed array passes through empty — the store's length gate
    // downgrades it to a single move of `id`
    expect(
      parseMoveDropPayload({ id: 'x', containerId: 'y', index: 0, slot: 'into', ids: [7] }),
    ).toEqual({ id: 'x', containerId: 'y', index: 0, slot: 'into', ids: [] });
  });

  it('drops a non-array ids entirely (single-move semantics preserved)', () => {
    expect(parseMoveIdPayload({ id: 'x', ids: 'a' })?.ids).toBeUndefined();
    expect(parseMoveIdPayload({ id: 'x', ids: null })?.ids).toBeUndefined();
    expect(parseMoveIdPayload({ id: 'x', ids: 42 })).toEqual({ id: 'x' });
    expect(
      parseMoveDropPayload({ id: 'x', containerId: 'y', index: 0, slot: 'into', ids: 42 })?.ids,
    ).toBeUndefined();
    // ids never substitutes for a missing/malformed id — the payload is dropped
    expect(parseMoveIdPayload({ ids: ['a'] })).toBeNull();
    expect(
      parseMoveDropPayload({ ids: ['a'], containerId: 'y', index: 0, slot: 'into' }),
    ).toBeNull();
  });
});

describe('parseSidecarFeatures', () => {
  it('parses the v2 feature array', () => {
    expect(
      parseSidecarFeatures({ features: ['dnd-hittest', 'select', 'prop-specs'], version: 2 }),
    ).toEqual(['dnd-hittest', 'select', 'prop-specs']);
  });

  it('still works with v1 payloads (dnd-hittest only)', () => {
    expect(parseSidecarFeatures({ features: ['dnd-hittest'], version: 1 })).toEqual([
      'dnd-hittest',
    ]);
  });

  it('treats malformed payloads as featureless', () => {
    expect(parseSidecarFeatures(undefined)).toEqual([]);
    expect(parseSidecarFeatures(null)).toEqual([]);
    expect(parseSidecarFeatures('x')).toEqual([]);
    expect(parseSidecarFeatures({})).toEqual([]);
    expect(parseSidecarFeatures({ features: 'dnd-hittest' })).toEqual([]);
    expect(parseSidecarFeatures({ features: [1, 'select', null] })).toEqual(['select']);
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
