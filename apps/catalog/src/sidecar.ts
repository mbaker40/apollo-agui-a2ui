/**
 * COMPOSERX sidecar v2 (contract sections 4, 4b, 4c, 4d). Rides the same
 * postMessage channel as the Preview Bridge with the same origin rules:
 * accepts host messages via DomainOriginVerificationService, replies to the
 * origin given by `?origin=` (falling back to our own origin, exactly like
 * the bridge's resolveExpectedParentOrigin).
 *
 * Responsibilities:
 * - v1 (dnd-hittest): mirror the component tree from RENDER_A2UI (read-only),
 *   hit-test COMPOSERX_DND_HOVER points against the `data-a2ui-id` wrappers
 *   stamped by src/branded-catalog.tsx, reply COMPOSERX_DND_TARGET, and render
 *   the dashed drop indicators (section 4b; cleared on COMPOSERX_DND_END).
 * - v2 (select): edit/preview modes (COMPOSERX_SET_MODE, default 'preview'
 *   so a host that never speaks COMPOSERX — the official hosted composer —
 *   gets a fully interactive standard renderer; our composer sends
 *   SET_MODE 'edit' in every handshake).
 *   Edit mode installs a transparent full-viewport "edit veil" that swallows
 *   every pointer interaction (Buttons cannot fire, TextFields cannot focus);
 *   clicks hit-test through it via elementsFromPoint and post COMPOSERX_SELECT
 *   with the deepest component id (null for background). The composer answers
 *   with COMPOSERX_SET_SELECTION, drawn as a solid 2px accent outline that
 *   re-anchors after every RENDER_A2UI, on resize/scroll, and via a
 *   ResizeObserver on the selected component's box.
 * - v2 (prop-specs): posts COMPOSERX_PROP_SPECS (derived from the real zod
 *   schemas, see src/prop-specs.ts) once, right after COMPOSERX_SIDECAR_READY.
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
import { derivePropSpecs, type PropSpecsPayload } from './prop-specs';
import { brandedBasicCatalog } from './branded-catalog';

export const COMPOSERX_SIDECAR_READY = 'COMPOSERX_SIDECAR_READY';
export const COMPOSERX_DND_HOVER = 'COMPOSERX_DND_HOVER';
export const COMPOSERX_DND_END = 'COMPOSERX_DND_END';
export const COMPOSERX_DND_TARGET = 'COMPOSERX_DND_TARGET';
export const COMPOSERX_SET_MODE = 'COMPOSERX_SET_MODE';
export const COMPOSERX_SET_SELECTION = 'COMPOSERX_SET_SELECTION';
export const COMPOSERX_SELECT = 'COMPOSERX_SELECT';
export const COMPOSERX_PROP_SPECS = 'COMPOSERX_PROP_SPECS';

/** Contract section 4: sidecar v2 announcement payload. */
export const SIDECAR_FEATURES = ['dnd-hittest', 'select', 'prop-specs'] as const;
export const SIDECAR_VERSION = 2;

export const DROP_INDICATOR_LAYER_ID = 'composerx-drop-indicator-layer';
export const EDIT_VEIL_ID = 'composerx-edit-veil';
export const HOVER_LAYER_ID = 'composerx-hover-layer';
export const SELECTION_LAYER_ID = 'composerx-selection-layer';

/** Stamped on the veil and every overlay layer so hit-testing can skip them. */
const LAYER_ATTR = 'data-composerx-layer';

/** Stacking: veil above the surface, below every indicator layer. */
const Z_VEIL = '999990';
const Z_HOVER = '999994';
const Z_SELECTION = '999995';
const Z_DROP = '999998';

const ACCENT = 'var(--brand-accent, #6d28d9)';
const ACCENT_FAINT = 'color-mix(in srgb, var(--brand-accent, #6d28d9) 45%, transparent)';
const ACCENT_WASH = 'color-mix(in srgb, var(--brand-accent, #6d28d9) 8%, transparent)';
const ACCENT_HOVER = 'color-mix(in srgb, var(--brand-accent, #6d28d9) 70%, transparent)';

const store: SurfaceStore = createStore();
let started = false;
let announced = false;
let mode: 'edit' | 'preview' = 'preview';
let selectedId: string | null = null;
let veil: HTMLElement | null = null;
let hoverPoint: { x: number; y: number } | null = null;
let hoverFramePending = false;
let propSpecsCache: PropSpecsPayload | null = null;
let selectionObserver: ResizeObserver | null = null;
let observedElement: Element | null = null;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
const pendingFrames = new Set<number>();

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

function getPropSpecsPayload(): PropSpecsPayload {
  if (propSpecsCache === null) {
    try {
      propSpecsCache = derivePropSpecs(brandedBasicCatalog);
    } catch (error) {
      console.error('[composerx-sidecar] prop-spec derivation failed:', error);
      propSpecsCache = {};
    }
  }
  return propSpecsCache;
}

/**
 * Announces the sidecar to the host, immediately followed by the prop specs
 * (contract section 4d). Called from App after useA2uiSandbox's effect has
 * run, so both always follow the bridge's RENDERER_READY.
 */
export function announceComposerxSidecarReady(): void {
  announced = true;
  postToParent({
    type: COMPOSERX_SIDECAR_READY,
    payload: { features: [...SIDECAR_FEATURES], version: SIDECAR_VERSION },
  });
  postToParent({
    type: COMPOSERX_PROP_SPECS,
    payload: { components: getPropSpecsPayload() },
  });
}

/* ------------------------------------------------------------ geometry -- */

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

function wrapperFor(id: string): Element | null {
  return document.querySelector(`[data-a2ui-id="${escapeAttr(id)}"]`);
}

function rectForComponent(id: string): Rect | null {
  const wrapper = wrapperFor(id);
  if (wrapper === null) return null;
  return unionRectOf(wrapper);
}

/** Elements under a point, topmost first (empty when the DOM API is missing). */
function elementsAtPoint(x: number, y: number): Element[] {
  if (typeof document.elementsFromPoint === 'function') {
    try {
      return document.elementsFromPoint(x, y);
    } catch {
      return [];
    }
  }
  if (typeof document.elementFromPoint === 'function') {
    try {
      const element = document.elementFromPoint(x, y);
      return element === null ? [] : [element];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Deepest `[data-a2ui-id]` under the point, hit-testing THROUGH the sidecar's
 * own veil/indicator layers (they are skipped by attribute; the indicator
 * layers are pointer-events:none anyway, the veil is not).
 */
function hitTestDeepest(x: number, y: number): string | null {
  for (const element of elementsAtPoint(x, y)) {
    if (element.closest(`[${LAYER_ATTR}]`) !== null) continue;
    const wrapper = element.closest('[data-a2ui-id]');
    return wrapper?.getAttribute('data-a2ui-id') ?? null;
  }
  return null;
}

function viewportRect(): Rect {
  return {
    x: 0,
    y: 0,
    width: document.documentElement?.clientWidth ?? 0,
    height: document.documentElement?.clientHeight ?? 0,
  };
}

/* -------------------------------------------------------------- layers -- */

/**
 * Fixed + hidden overflow + pointer-events none: never affects body scroll
 * size, so it cannot feed back into the bridge's SURFACE_RESIZE measurements.
 */
function ensureLayer(id: string, zIndex: string): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  let layer = document.getElementById(id);
  if (layer === null) {
    layer = document.createElement('div');
    layer.id = id;
    layer.setAttribute(LAYER_ATTR, '');
    Object.assign(layer.style, {
      position: 'fixed',
      inset: '0',
      overflow: 'hidden',
      pointerEvents: 'none',
      zIndex,
    });
    document.body.appendChild(layer);
  }
  return layer;
}

function clearLayer(id: string): void {
  document.getElementById(id)?.replaceChildren();
}

function positionBox(element: HTMLElement, rect: Rect): void {
  Object.assign(element.style, {
    position: 'absolute',
    left: `${rect.x}px`,
    top: `${rect.y}px`,
    width: `${rect.width}px`,
    height: `${rect.height}px`,
    boxSizing: 'border-box',
  });
}

function inflate(rect: Rect, amount: number): Rect {
  return {
    x: rect.x - amount,
    y: rect.y - amount,
    width: rect.width + 2 * amount,
    height: rect.height + 2 * amount,
  };
}

/* ----------------------------------------------- drop indicators (4b) -- */

/**
 * Renders the Figma-like dashed drop indicators into `layer` (section 4b):
 * - 'into' → dashed 2px accent outline (6px radius) around the container
 *   rect with a very light accent wash;
 * - 'before'/'after' → dashed 2px accent insertion line (with dot end-caps)
 *   at the caret rect, plus a faint dashed outline around the container
 *   being spliced into;
 * - no target → nothing.
 * Exported for unit tests; inline longhand styles (borderStyle/-Width/-Color)
 * are used so jsdom's CSSOM preserves them.
 */
export function renderDropIndicator(
  layer: HTMLElement,
  target: DropTarget,
  getRect: (id: string) => Rect | null,
): void {
  layer.replaceChildren();
  if (target.rect === null || target.slot === null) return;

  if (target.slot === 'into') {
    const containerRect =
      (target.containerId !== null ? getRect(target.containerId) : null) ?? target.rect;
    const box = document.createElement('div');
    box.setAttribute('data-composerx-indicator', 'into');
    positionBox(box, containerRect);
    Object.assign(box.style, {
      borderStyle: 'dashed',
      borderWidth: '2px',
      borderColor: ACCENT,
      borderRadius: '6px',
      backgroundColor: ACCENT_WASH,
      transition: 'left 60ms linear, top 60ms linear, width 60ms linear, height 60ms linear',
    });
    layer.appendChild(box);
    return;
  }

  // 'before' / 'after': faint dashed outline around the spliced container...
  if (target.containerId !== null) {
    const containerRect = getRect(target.containerId);
    if (containerRect !== null) {
      const outline = document.createElement('div');
      outline.setAttribute('data-composerx-indicator', 'container');
      positionBox(outline, inflate(containerRect, 2));
      Object.assign(outline.style, {
        borderStyle: 'dashed',
        borderWidth: '1px',
        borderColor: ACCENT_FAINT,
        borderRadius: '6px',
      });
      layer.appendChild(outline);
    }
  }

  // ...plus the dashed insertion caret with small dot end-caps.
  const caret = document.createElement('div');
  caret.setAttribute('data-composerx-indicator', 'caret');
  positionBox(caret, target.rect);
  caret.style.transition =
    'left 60ms linear, top 60ms linear, width 60ms linear, height 60ms linear';
  const horizontal = target.rect.width >= target.rect.height;

  const line = document.createElement('div');
  line.setAttribute('data-composerx-indicator', 'caret-line');
  line.style.position = 'absolute';
  if (horizontal) {
    Object.assign(line.style, {
      left: '0',
      right: '0',
      top: '50%',
      marginTop: '-1px',
      borderTopStyle: 'dashed',
      borderTopWidth: '2px',
      borderTopColor: ACCENT,
    });
  } else {
    Object.assign(line.style, {
      top: '0',
      bottom: '0',
      left: '50%',
      marginLeft: '-1px',
      borderLeftStyle: 'dashed',
      borderLeftWidth: '2px',
      borderLeftColor: ACCENT,
    });
  }
  caret.appendChild(line);

  for (const end of ['start', 'end'] as const) {
    const dot = document.createElement('div');
    dot.setAttribute('data-composerx-indicator', 'caret-dot');
    Object.assign(dot.style, {
      position: 'absolute',
      width: '6px',
      height: '6px',
      borderRadius: '999px',
      backgroundColor: ACCENT,
    });
    if (horizontal) {
      dot.style.top = '50%';
      dot.style.marginTop = '-3px';
      dot.style[end === 'start' ? 'left' : 'right'] = '-3px';
    } else {
      dot.style.left = '50%';
      dot.style.marginLeft = '-3px';
      dot.style[end === 'start' ? 'top' : 'bottom'] = '-3px';
    }
    caret.appendChild(dot);
  }
  layer.appendChild(caret);
}

function clearIndicator(): void {
  clearLayer(DROP_INDICATOR_LAYER_ID);
}

function drawIndicator(target: DropTarget): void {
  const layer = ensureLayer(DROP_INDICATOR_LAYER_ID, Z_DROP);
  if (layer === null) return;
  renderDropIndicator(layer, target, rectForComponent);
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
    hitId: hitTestDeepest(x, y),
    store,
    getRect: rectForComponent,
    viewport: viewportRect(),
  });
  drawIndicator(target);
  postToParent({ type: COMPOSERX_DND_TARGET, payload: target });
}

/* -------------------------------------------- edit veil + select (4c) -- */

function scheduleFrame(callback: () => void): void {
  if (typeof requestAnimationFrame === 'function') {
    const id = requestAnimationFrame(() => {
      pendingFrames.delete(id);
      callback();
    });
    pendingFrames.add(id);
  } else {
    later(callback, 16);
  }
}

function later(callback: () => void, delay: number): void {
  const id = setTimeout(() => {
    pendingTimers.delete(id);
    callback();
  }, delay);
  pendingTimers.add(id);
}

function onVeilClick(event: MouseEvent): void {
  const id = hitTestDeepest(event.clientX, event.clientY);
  postToParent({ type: COMPOSERX_SELECT, payload: { id } });
}

function onVeilPointerMove(event: PointerEvent): void {
  hoverPoint = { x: event.clientX, y: event.clientY };
  if (hoverFramePending) return;
  hoverFramePending = true;
  scheduleFrame(() => {
    hoverFramePending = false;
    refreshHoverOutline();
  });
}

function onVeilPointerLeave(): void {
  hoverPoint = null;
  clearLayer(HOVER_LAYER_ID);
}

function ensureVeil(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (veil === null) {
    veil = document.createElement('div');
    veil.id = EDIT_VEIL_ID;
    veil.setAttribute(LAYER_ATTR, '');
    // Transparent, full-viewport, pointer-events:auto: swallows every pointer
    // interaction with the rendered surface while in edit mode. position:fixed
    // keeps it out of SURFACE_RESIZE measurements.
    Object.assign(veil.style, {
      position: 'fixed',
      inset: '0',
      backgroundColor: 'transparent',
      cursor: 'default',
      pointerEvents: 'auto',
      zIndex: Z_VEIL,
    });
    veil.addEventListener('click', onVeilClick);
    veil.addEventListener('pointermove', onVeilPointerMove);
    veil.addEventListener('pointerleave', onVeilPointerLeave);
  }
  if (!veil.isConnected) document.body.appendChild(veil);
  return veil;
}

function removeVeil(): void {
  veil?.remove();
}

/** Edit mode also drops focus a component may already hold (typed input). */
function blurActiveComponentElement(): void {
  const active = document.activeElement;
  if (active instanceof HTMLElement && active.closest('[data-a2ui-id]') !== null) {
    active.blur();
  }
}

/** Capture-phase guard: nothing inside a component may keep focus in edit mode. */
function onFocusIn(event: FocusEvent): void {
  if (mode !== 'edit') return;
  const target = event.target;
  if (target instanceof HTMLElement && target.closest('[data-a2ui-id]') !== null) {
    target.blur();
  }
}

/** Applies the current mode to the DOM. Safe to call repeatedly (idempotent). */
function applyMode(): void {
  if (typeof document === 'undefined' || !document.body) return;
  if (mode === 'edit') {
    ensureVeil();
    blurActiveComponentElement();
  } else {
    removeVeil();
    hoverPoint = null;
    clearLayer(HOVER_LAYER_ID);
  }
  refreshSelectionOutline();
}

function handleSetMode(payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) return;
  const nextMode = (payload as { mode?: unknown }).mode;
  if (nextMode !== 'edit' && nextMode !== 'preview') return;
  mode = nextMode;
  applyMode();
}

/* -------------------------------------------- selection outlines (4c) -- */

function handleSetSelection(payload: unknown): void {
  if (typeof payload !== 'object' || payload === null) return;
  const id = (payload as { id?: unknown }).id;
  if (typeof id !== 'string' && id !== null) return;
  selectedId = id;
  refreshSelectionOutline();
}

function observeSelected(element: Element | null): void {
  if (typeof ResizeObserver === 'undefined') return;
  if (observedElement === element) return;
  selectionObserver?.disconnect();
  observedElement = element;
  if (element !== null) {
    selectionObserver ??= new ResizeObserver(() => refreshSelectionOutline());
    selectionObserver.observe(element);
  }
}

/**
 * Draws (or clears) the solid selection outline for the current mode +
 * selection. Measures by id at call time, so calling it again re-anchors.
 */
function refreshSelectionOutline(): void {
  if (typeof document === 'undefined' || !document.body) return;
  const wrapper = mode === 'edit' && selectedId !== null ? wrapperFor(selectedId) : null;
  if (wrapper === null) {
    clearLayer(SELECTION_LAYER_ID);
    observeSelected(null);
    return;
  }
  // jsdom (and a component rendering no boxes) yields no union rect; fall
  // back to the wrapper's own bounding rect so the outline still exists.
  const rect = unionRectOf(wrapper) ?? domRectOf(wrapper);
  const layer = ensureLayer(SELECTION_LAYER_ID, Z_SELECTION);
  if (layer === null) return;
  let box = layer.firstElementChild as HTMLElement | null;
  if (box === null) {
    box = document.createElement('div');
    box.setAttribute('data-composerx-outline', 'selection');
    // Solid 2px accent outline with a 1px offset (contract 4c): the drawn
    // box is the component rect inflated by 3px (1px gap + 2px border).
    Object.assign(box.style, {
      borderStyle: 'solid',
      borderWidth: '2px',
      borderColor: ACCENT,
      borderRadius: '6px',
    });
    layer.appendChild(box);
  }
  positionBox(box, inflate(rect, 3));
  observeSelected(wrapper.firstElementChild);
}

function domRectOf(element: Element): Rect {
  const rect = element.getBoundingClientRect();
  return { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
}

function refreshHoverOutline(): void {
  if (typeof document === 'undefined' || !document.body) return;
  if (mode !== 'edit' || hoverPoint === null) {
    clearLayer(HOVER_LAYER_ID);
    return;
  }
  const id = hitTestDeepest(hoverPoint.x, hoverPoint.y);
  const rect = id !== null ? rectForComponent(id) : null;
  if (id === null || rect === null) {
    clearLayer(HOVER_LAYER_ID);
    return;
  }
  const layer = ensureLayer(HOVER_LAYER_ID, Z_HOVER);
  if (layer === null) return;
  let box = layer.firstElementChild as HTMLElement | null;
  if (box === null) {
    box = document.createElement('div');
    box.setAttribute('data-composerx-outline', 'hover');
    // Subtle 1px accent affordance under the pointer (contract 4c; local only).
    Object.assign(box.style, {
      borderStyle: 'solid',
      borderWidth: '1px',
      borderColor: ACCENT_HOVER,
      borderRadius: '4px',
    });
    layer.appendChild(box);
  }
  positionBox(box, inflate(rect, 1));
}

/**
 * Re-anchors the selection outline after a RENDER_A2UI. The bridge defers
 * createSurface remounts by one macrotask (two-step dispatch) and React
 * commits + lays out after that, so measure now, then on chained timeouts,
 * then on a couple of chained animation frames.
 */
function scheduleSelectionReanchor(): void {
  refreshSelectionOutline();
  later(() => {
    refreshSelectionOutline();
    later(refreshSelectionOutline, 0);
    scheduleFrame(() => {
      refreshSelectionOutline();
      scheduleFrame(refreshSelectionOutline);
    });
  }, 0);
}

function onWindowChange(): void {
  refreshSelectionOutline();
}

/* ------------------------------------------------------------ wire-up -- */

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
      scheduleSelectionReanchor();
      break;
    case COMPOSERX_DND_HOVER:
      handleHover(data.payload);
      break;
    case COMPOSERX_DND_END:
      clearIndicator();
      break;
    case COMPOSERX_SET_MODE:
      handleSetMode(data.payload);
      break;
    case COMPOSERX_SET_SELECTION:
      handleSetSelection(data.payload);
      break;
    default:
      break;
  }
}

/** Installs the sidecar listeners and the default-mode (edit) veil. */
export function initComposerxSidecar(): void {
  if (started || typeof window === 'undefined') return;
  started = true;
  window.addEventListener('message', onMessage);
  window.addEventListener('resize', onWindowChange);
  window.addEventListener('scroll', onWindowChange, true);
  document.addEventListener('focusin', onFocusIn, true);
  applyMode();
}

/** Test hook: tear down listeners, overlays, and reset module state. */
export function destroyComposerxSidecar(): void {
  if (typeof window !== 'undefined') {
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', onWindowChange);
    window.removeEventListener('scroll', onWindowChange, true);
    document.removeEventListener('focusin', onFocusIn, true);
  }
  for (const id of pendingTimers) clearTimeout(id);
  pendingTimers.clear();
  if (typeof cancelAnimationFrame === 'function') {
    for (const id of pendingFrames) cancelAnimationFrame(id);
  }
  pendingFrames.clear();
  selectionObserver?.disconnect();
  selectionObserver = null;
  observedElement = null;
  veil?.remove();
  veil = null;
  started = false;
  announced = false;
  mode = 'edit';
  selectedId = null;
  hoverPoint = null;
  hoverFramePending = false;
  store.surfaceId = null;
  store.components = new Map();
  for (const id of [DROP_INDICATOR_LAYER_ID, HOVER_LAYER_ID, SELECTION_LAYER_ID]) {
    document.getElementById(id)?.remove();
  }
}

/** Test hook: whether the ready announcement has been posted. */
export function hasAnnouncedSidecarReady(): boolean {
  return announced;
}
