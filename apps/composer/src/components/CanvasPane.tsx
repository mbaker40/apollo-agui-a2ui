import { useEffect, useMemo, useRef, useState } from 'react';
import type { DndHoverPayload, DndTargetPayload } from '../lib/bridge-host';
import { BridgeHost, SIDECAR_FEATURE_DND } from '../lib/bridge-host';
import { buildIframeSrc } from '../lib/settings';
import { insertTargetFor, toRenderMessages } from '../lib/surface-doc';
import { useComposerState, useStore } from '../state/context';
import { DRAG_MIME } from './Glossary';
import { Drawer } from './Drawer';
import { LayoutTree } from './LayoutTree';

export const HANDSHAKE_TIMEOUT_MS = 10_000;
const MIN_SURFACE_HEIGHT = 320;

function shortenUrl(url: string): string {
  return url.length > 42 ? `${url.slice(0, 39)}…` : url;
}

export function CanvasPane() {
  const store = useStore();
  const state = useComposerState();
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<BridgeHost | null>(null);
  const readyRef = useRef(false);
  const dndTargetRef = useRef<DndTargetPayload | null>(null);
  const rafRef = useRef(0);
  const hoverRef = useRef<DndHoverPayload | null>(null);
  const [surfaceHeight, setSurfaceHeight] = useState(MIN_SURFACE_HEIGHT);
  const [nonce, setNonce] = useState(0);

  const rendererUrl = state.settings.rendererUrl;
  // Theme is read imperatively on purpose: the ?theme= param only matters at
  // load time, and later toggles go over SET_THEME without remounting.
  const iframeSrc = useMemo(
    () => buildIframeSrc(rendererUrl, store.getState().settings.theme),
    [store, rendererUrl, nonce],
  );

  useEffect(() => {
    const iframe = iframeRef.current;
    if (!iframe) return;
    store.actions.handshakeReset();
    readyRef.current = false;
    dndTargetRef.current = null;
    setSurfaceHeight(MIN_SURFACE_HEIGHT);
    const host = new BridgeHost({
      getTheme: () => store.getState().settings.theme,
      getRenderItems: () => toRenderMessages(store.getState().doc),
      // Mode + selection survive a renderer reload: re-sent post-RENDER_A2UI
      // (id = primary for v3 catalogs, ids = the full §4f list for v4).
      getMode: () => store.getState().mode,
      getSelection: () => store.getState().selectedComponentId,
      getSelectionIds: () => store.getState().selectedComponentIds,
      onReady: () => {
        readyRef.current = true;
        store.actions.bridgeReady();
      },
      onCatalog: (payload) => store.actions.bridgeCatalog(payload),
      onUsages: (payload) => store.actions.bridgeUsages(payload),
      onDataModelChange: (payload) => store.actions.bridgeDataModel(payload),
      onSendToServer: (payload) => store.actions.bridgeAction(payload),
      onConsoleLog: (payload) => store.actions.bridgeConsole(payload),
      onSurfaceResize: (payload) => {
        if (Number.isFinite(payload.height)) {
          setSurfaceHeight(Math.max(MIN_SURFACE_HEIGHT, Math.round(payload.height)));
        }
      },
      onSidecarReady: (payload) => store.actions.bridgeSidecarReady(payload),
      onDndTarget: (payload) => {
        dndTargetRef.current = payload;
      },
      onSelect: (payload) => store.actions.bridgeSelect(payload),
      onMarquee: (payload) => store.actions.bridgeMarquee(payload),
      onPropSpecs: (payload) => store.actions.bridgePropSpecs(payload),
      onMoveStart: (payload) => store.actions.bridgeMoveStart(payload),
      onMoveDrop: (payload) => store.actions.bridgeMoveDrop(payload),
      onMoveCancel: (payload) => store.actions.bridgeMoveCancel(payload),
      onUnknown: (type, payload) => store.actions.bridgeUnknown(type, payload),
    });
    host.register(iframe, rendererUrl);
    hostRef.current = host;
    store.attachPort(host);
    const timer = setTimeout(() => {
      if (!readyRef.current) store.actions.handshakeTimedOut();
    }, HANDSHAKE_TIMEOUT_MS);
    return () => {
      clearTimeout(timer);
      store.attachPort(null);
      hostRef.current = null;
      host.dispose();
    };
  }, [store, rendererUrl, nonce]);

  // When a glossary drag ends anywhere, tell the sidecar to clear its highlight.
  useEffect(() => {
    if (!state.dragging) {
      hostRef.current?.sendDndEnd();
      dndTargetRef.current = null;
    }
  }, [state.dragging]);

  const sendHover = (x: number, y: number) => {
    hoverRef.current = { x, y };
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      if (hoverRef.current) hostRef.current?.sendDndHover(hoverRef.current);
    });
  };

  // The glossary's pointer-based grip drag (contract §7b) drives the SAME
  // COMPOSERX_DND_HOVER/END + held-DND_TARGET path as the HTML5 overlay:
  // hoverAt converts viewport coords by subtracting the iframe bounding rect,
  // exactly like onOverlayDragOver below. Only refs are touched, so the
  // registration can stay mounted for the pane's lifetime.
  useEffect(() => {
    store.attachCanvasDnd({
      getIframeRect: () => iframeRef.current?.getBoundingClientRect() ?? null,
      hoverAt: (clientX, clientY) => {
        const rect = iframeRef.current?.getBoundingClientRect();
        if (rect) sendHover(clientX - rect.left, clientY - rect.top);
      },
      endHover: () => {
        hostRef.current?.sendDndEnd();
        dndTargetRef.current = null;
      },
      currentTarget: () => dndTargetRef.current,
    });
    return () => store.attachCanvasDnd(null);
    // sendHover is re-created per render but closes over stable refs only.
  }, [store]);

  const onOverlayDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    const rect = iframeRef.current?.getBoundingClientRect();
    if (!rect) return;
    sendHover(e.clientX - rect.left, e.clientY - rect.top);
  };

  const onOverlayDragLeave = () => {
    hostRef.current?.sendDndEnd();
    dndTargetRef.current = null;
  };

  const onOverlayDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const name = e.dataTransfer.getData(DRAG_MIME);
    store.actions.setDragging(false);
    if (!name) return;
    // Held-target-or-structural-fallback logic shared with the grip drag.
    store.actions.insertFromDrag(name, dndTargetRef.current);
    hostRef.current?.sendDndEnd();
    dndTargetRef.current = null;
  };

  const ready = state.handshake.ready;
  const timedOut = state.handshake.timedOut;
  const theme = state.settings.theme;
  const mode = state.mode;
  const status = ready ? 'ok' : timedOut ? 'err' : 'wait';
  const dndSidecar = state.handshake.sidecarFeatures.includes(SIDECAR_FEATURE_DND);
  const structuralTarget = insertTargetFor(state.doc, state.selectedComponentId);

  return (
    <section className="canvas-pane" aria-label="Canvas">
      <div className="toolbar">
        <button
          onClick={() => store.actions.undo()}
          disabled={state.undoStack.length === 0}
          title="Undo"
        >
          ↺ Undo
        </button>
        <button
          onClick={() => store.actions.redo()}
          disabled={state.redoStack.length === 0}
          title="Redo"
        >
          ↻ Redo
        </button>
        <button
          onClick={() => {
            if (
              window.confirm('Clear the canvas? This empties the layout to a bare root Column.')
            ) {
              store.actions.clearCanvas();
            }
          }}
          title="Clear canvas"
        >
          Clear
        </button>
        <button
          onClick={() => store.actions.setTheme(theme === 'light' ? 'dark' : 'light')}
          title="Toggle shell + renderer theme"
        >
          {theme === 'light' ? '◑ Dark' : '◐ Light'}
        </button>
        <div className="mode-toggle" role="group" aria-label="Canvas mode">
          <button
            data-testid="mode-edit"
            title="Edit mode"
            aria-pressed={mode === 'edit'}
            className={mode === 'edit' ? 'active' : ''}
            onClick={() => store.actions.setMode('edit')}
          >
            Edit
          </button>
          <button
            data-testid="mode-preview"
            title="Preview mode"
            aria-pressed={mode === 'preview'}
            className={mode === 'preview' ? 'active' : ''}
            onClick={() => store.actions.setMode('preview')}
          >
            Preview
          </button>
        </div>
        <span className="toolbar-spacer" />
        <span className={`renderer-url dot-${status}`} title={rendererUrl}>
          <span className="dot" aria-hidden />
          {shortenUrl(rendererUrl)}
        </span>
        <button
          className="icon-button"
          onClick={() => store.actions.setSettingsOpen(true)}
          title="Settings"
          aria-label="Settings"
        >
          ⚙
        </button>
      </div>

      <LayoutTree />

      <div className="canvas-scroll">
        <div className="canvas-frame" style={{ height: `${surfaceHeight}px` }}>
          <iframe
            key={`${rendererUrl}#${nonce}`}
            ref={iframeRef}
            className="renderer-iframe"
            title="A2UI renderer"
            src={iframeSrc}
            sandbox="allow-scripts allow-same-origin"
          />
          {!ready && !timedOut && (
            <div className="canvas-overlay waiting">
              <div className="spinner" aria-hidden />
              <p>Waiting for renderer at {rendererUrl}…</p>
            </div>
          )}
          {!ready && timedOut && (
            <div className="canvas-overlay error">
              <p>
                <strong>No handshake from the renderer.</strong>
              </p>
              <p className="mono">{rendererUrl}</p>
              <p>
                Check that the catalog app is running (pnpm --filter @mwe/composer-catalog dev), or
                point the composer at another renderer in settings.
              </p>
              <div className="overlay-actions">
                <button onClick={() => setNonce((n) => n + 1)}>Retry</button>
                <button onClick={() => store.actions.setSettingsOpen(true)}>Open settings</button>
              </div>
            </div>
          )}
          {state.dragging && (
            <div
              className="drop-overlay"
              data-testid="drop-overlay"
              onDragEnter={(e) => e.preventDefault()}
              onDragOver={onOverlayDragOver}
              onDragLeave={onOverlayDragLeave}
              onDrop={onOverlayDrop}
            >
              <span className="drop-hint">
                {dndSidecar
                  ? 'Drop to insert at the highlighted position'
                  : `Drop to insert into #${structuralTarget}`}
              </span>
            </div>
          )}
        </div>
      </div>

      <Drawer />
    </section>
  );
}
