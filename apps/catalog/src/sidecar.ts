/**
 * COMPOSERX drag-and-drop sidecar (contract section 4). Rides the same
 * postMessage channel as the Preview Bridge with the same origin rules:
 * accepts host messages via DomainOriginVerificationService, replies to the
 * origin given by `?origin=` (falling back to our own origin, exactly like
 * the bridge's resolveExpectedParentOrigin).
 *
 * Responsibilities: mirror the component tree from RENDER_A2UI (read-only),
 * hit-test COMPOSERX_DND_HOVER points against the `data-a2ui-id` wrappers
 * stamped by src/branded-catalog.tsx, reply COMPOSERX_DND_TARGET, and render
 * the drop indicator overlay (cleared on COMPOSERX_DND_END).
 */

import { DomainOriginVerificationService } from 'a2ui-bridge';
import {
  applyRenderItems,
  createStore,
  resolveDropTarget,
  type DropTarget,
  type Rect,
  type SurfaceStore,
} from './sidecar-math';

export const COMPOSERX_SIDECAR_READY = 'COMPOSERX_SIDECAR_READY';
export const COMPOSERX_DND_HOVER = 'COMPOSERX_DND_HOVER';
export const COMPOSERX_DND_END = 'COMPOSERX_DND_END';
export const COMPOSERX_DND_TARGET = 'COMPOSERX_DND_TARGET';

const OVERLAY_ID = 'composerx-drop-indicator-layer';

const store: SurfaceStore = createStore();
let started = false;
let announced = false;

/** Same target-origin resolution as PreviewBridge.resolveExpectedParentOrigin. */
export function resolveParentOrigin(): string {
  if (typeof window === 'undefined') return '*';
  const search = window.location?.search;
  if (search) {
    try {
      const origin = new URLSearchParams(search).get('origin');
      if (origin && /^https?:\/\/[^/]+$/.test(origin)) return origin;
    } catch {
      // fall through to our own origin
    }
  }
  return window.location.origin || '*';
}

function postToParent(message: { type: string; payload?: unknown }): void {
  if (typeof window === 'undefined' || !window.parent || window.parent === window) return;
  try {
    window.parent.postMessage(message, resolveParentOrigin());
  } catch (error) {
    console.error('[composerx-sidecar] postMessage failed:', error);
  }
}

/**
 * Announces the sidecar to the host. Called from App after useA2uiSandbox's
 * effect has run, so it always follows the bridge's RENDERER_READY.
 */
export function announceComposerxSidecarReady(): void {
  announced = true;
  postToParent({
    type: COMPOSERX_SIDECAR_READY,
    payload: { features: ['dnd-hittest'], version: 1 },
  });
}

/** Union of the boxes rendered by an element (recursing through box-less wrappers). */
function unionRectOf(element: Element): Rect | null {
  const boxes = element.getClientRects();
  if (boxes.length > 0) {
    const rect = element.getBoundingClientRect();
    return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
  }
  let union: Rect | null = null;
  for (const child of Array.from(element.children)) {
    const childRect = unionRectOf(child);
    if (childRect === null) continue;
    if (union === null) {
      union = { ...childRect };
    } else {
      const x = Math.min(union.x, childRect.x);
      const y = Math.min(union.y, childRect.y);
      union = {
        x,
        y,
        width: Math.max(union.x + union.width, childRect.x + childRect.width) - x,
        height: Math.max(union.y + union.height, childRect.y + childRect.height) - y,
      };
    }
  }
  return union;
}

function escapeAttr(id: string): string {
  return typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
    ? CSS.escape(id)
    : id.replace(/["\\]/g, '\\$&');
}

function rectForComponent(id: string): Rect | null {
  const wrapper = document.querySelector(`[data-a2ui-id="${escapeAttr(id)}"]`);
  if (wrapper === null) return null;
  return unionRectOf(wrapper);
}

function hitTest(x: number, y: number): string | null {
  if (typeof document.elementFromPoint !== 'function') return null;
  try {
    const element = document.elementFromPoint(x, y);
    const wrapper = element?.closest('[data-a2ui-id]');
    return wrapper?.getAttribute('data-a2ui-id') ?? null;
  } catch {
    return null;
  }
}

function viewportRect(): Rect {
  return {
    x: 0,
    y: 0,
    width: document.documentElement?.clientWidth ?? 0,
    height: document.documentElement?.clientHeight ?? 0,
  };
}

function ensureOverlay(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  let layer = document.getElementById(OVERLAY_ID);
  if (layer === null) {
    layer = document.createElement('div');
    layer.id = OVERLAY_ID;
    // Fixed + hidden overflow: never affects body scroll size, so it cannot
    // feed back into the bridge's SURFACE_RESIZE measurements.
    Object.assign(layer.style, {
      position: 'fixed',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex: '999998',
    });
    document.body.appendChild(layer);
  }
  return layer;
}

function clearIndicator(): void {
  const layer = document.getElementById(OVERLAY_ID);
  if (layer !== null) layer.replaceChildren();
}

function drawIndicator(target: DropTarget): void {
  const layer = ensureOverlay();
  if (layer === null) return;
  layer.replaceChildren();
  if (target.rect === null || target.slot === null) return;
  const indicator = document.createElement('div');
  const accent = 'var(--brand-accent, #6d28d9)';
  const base = {
    position: 'absolute',
    left: `${target.rect.x}px`,
    top: `${target.rect.y}px`,
    width: `${target.rect.width}px`,
    height: `${target.rect.height}px`,
    boxSizing: 'border-box',
    transition: 'left 60ms linear, top 60ms linear, width 60ms linear, height 60ms linear',
  };
  if (target.slot === 'into') {
    Object.assign(indicator.style, base, {
      border: `2px solid ${accent}`,
      borderRadius: 'var(--brand-radius, 10px)',
      background: 'color-mix(in srgb, var(--brand-accent, #6d28d9) 10%, transparent)',
    });
  } else {
    Object.assign(indicator.style, base, {
      background: accent,
      borderRadius: '2px',
      boxShadow: '0 0 0 2px color-mix(in srgb, var(--brand-accent, #6d28d9) 25%, transparent)',
    });
  }
  layer.appendChild(indicator);
}

function handleHover(payload: unknown): void {
  if (
    typeof payload !== 'object' ||
    payload === null ||
    typeof (payload as { x?: unknown }).x !== 'number' ||
    typeof (payload as { y?: unknown }).y !== 'number'
  ) {
    return;
  }
  const { x, y } = payload as { x: number; y: number };
  const target = resolveDropTarget({
    x,
    y,
    hitId: hitTest(x, y),
    store,
    getRect: rectForComponent,
    viewport: viewportRect(),
  });
  drawIndicator(target);
  postToParent({ type: COMPOSERX_DND_TARGET, payload: target });
}

function onMessage(event: MessageEvent): void {
  if (
    !DomainOriginVerificationService.verifyStrictOrigin(event.origin, event.source, window.parent)
  ) {
    return;
  }
  const data = event.data as { type?: unknown; payload?: unknown } | null;
  if (data === null || typeof data !== 'object' || typeof data.type !== 'string') return;
  switch (data.type) {
    case 'RENDER_A2UI':
      // Read-only mirror of the tree; the bridge does the actual rendering.
      applyRenderItems(store, data.payload !== undefined ? data.payload : data);
      clearIndicator();
      break;
    case COMPOSERX_DND_HOVER:
      handleHover(data.payload);
      break;
    case COMPOSERX_DND_END:
      clearIndicator();
      break;
    default:
      break;
  }
}

/** Installs the sidecar listeners. Called once from main.tsx. */
export function initComposerxSidecar(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('message', onMessage);
}

/** Test hook: tear down listeners and reset module state. */
export function destroyComposerxSidecar(): void {
  if (typeof window !== 'undefined') window.removeEventListener('message', onMessage);
  started = false;
  announced = false;
  store.surfaceId = null;
  store.components = new Map();
  document.getElementById(OVERLAY_ID)?.remove();
}

/** Test hook: whether the ready announcement has been posted. */
export function hasAnnouncedSidecarReady(): boolean {
  return announced;
}
