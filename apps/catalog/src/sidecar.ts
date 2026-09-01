/**
 * COMPOSERX sidecar v4 (contract sections 4, 4b, 4c, 4d, 4e, 4f). Rides the
 * same postMessage channel as the Preview Bridge with the same origin rules:
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
 * - v3 (move, section 4e): press-and-drag on a rendered component in edit
 *   mode lifts it (Figma-style). The whole gesture lives on the edit veil
 *   (pointerdown/-move/-up with setPointerCapture); movement past ~5px turns
 *   the press into a move (a sub-threshold pointerup stays a click-select,
 *   and once a move starts the gesture's click-derived SELECT is
 *   suppressed). During the drag the sidecar renders a translucent
 *   accent-bordered ghost that follows the pointer, dims the origin rect
 *   under a dashed outline, and drives the section-4b dashed drop indicators
 *   through the same hit-test path with the moved subtree excluded. It posts
 *   COMPOSERX_MOVE_START on lift, then MOVE_DROP {id, containerId, index,
 *   slot} (index = position AFTER the moved id's removal) or MOVE_CANCEL
 *   (no target, Escape mid-drag, pointercancel). The catalog mutates
 *   nothing — the composer applies the move and re-sends RENDER_A2UI.
 * - v4 (multi-select, section 4f): the SAME pointerdown can now end four
 *   ways. On a COMPONENT: sub-threshold quick release = plain SELECT (the
 *   existing click path, additive:true when shift is held); sub-threshold
 *   press held ~350ms = additive SELECT toggle (checked BEFORE the 4e lift —
 *   the long-press timer is cancelled the moment the 5px threshold is
 *   crossed, and once it fires the gesture is consumed: pointer capture is
 *   kept but all subsequent movement is ignored, the move lift can no longer
 *   start, and the trailing click is suppressed; a brief accent pulse on the
 *   pressed component gives haptic-style feedback). Over-threshold = the 4e
 *   move lift, exactly as before. On the BACKGROUND (deepest hit null):
 *   sub-threshold release stays the deselect click (SELECT {id:null});
 *   crossing the threshold starts the marquee — a SOLID 1px accent rubber
 *   band with an ~8% accent wash (dashed stays reserved for drop
 *   indicators), candidates recomputed each rAF (marqueeCandidates,
 *   topmost-intersecting rule) and live-highlighted with light solid
 *   outlines; pointerup posts COMPOSERX_MARQUEE {ids} ([] when nothing
 *   intersects); Escape or pointercancel aborts silently (visuals cleared,
 *   NO message). COMPOSERX_SET_SELECTION additionally accepts {id, ids?}:
 *   the primary keeps the 2px solid accent outline, every other id in `ids`
 *   gets a lighter 1.5px / 70%-accent outline; all outlines re-anchor after
 *   RENDER_A2UI through the same machinery, and ids that no longer render
 *   are dropped individually. A payload without `ids` behaves exactly as v3.
 */

import { DomainOriginVerificationService } from 'a2ui-bridge';
import {
  applyRenderItems,
  createStore,
  marqueeCandidates,
  resolveDropTarget,
  resolveLiftAnchor,
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
export const COMPOSERX_MOVE_START = 'COMPOSERX_MOVE_START';
export const COMPOSERX_MOVE_DROP = 'COMPOSERX_MOVE_DROP';
export const COMPOSERX_MOVE_CANCEL = 'COMPOSERX_MOVE_CANCEL';
export const COMPOSERX_MARQUEE = 'COMPOSERX_MARQUEE';

/** Contract section 4: sidecar v4 announcement payload. */
export const SIDECAR_FEATURES = [
  'dnd-hittest',
  'select',
  'prop-specs',
  'move',
  'multi-select',
] as const;
export const SIDECAR_VERSION = 4;

export const DROP_INDICATOR_LAYER_ID = 'composerx-drop-indicator-layer';
export const EDIT_VEIL_ID = 'composerx-edit-veil';
/**
 * Toggled on <html> while in edit mode. brand.css keys empty-container
 * placeholder drop zones off it: an empty Row/Column/List renders at
 * near-zero size, which makes it impossible to hit with a drop (especially
 * a finger) — in edit mode it gets a minimum dashed box, giving both a
 * visible affordance and real geometry for elementsFromPoint hit-testing.
 */
export const EDIT_MODE_CLASS = 'composerx-edit';
export const HOVER_LAYER_ID = 'composerx-hover-layer';
export const SELECTION_LAYER_ID = 'composerx-selection-layer';
export const MOVE_LAYER_ID = 'composerx-move-layer';
/** Marquee rubber band + live candidate highlights + the long-press pulse. */
export const MARQUEE_LAYER_ID = 'composerx-marquee-layer';

/**
 * Contract sections 4e/4f: pointer travel (px) past which a press becomes a
 * move (component press) or a marquee (background press).
 */
export const MOVE_THRESHOLD_PX = 5;

/**
 * Contract section 4f: a component press held this long WITHOUT crossing
 * MOVE_THRESHOLD_PX posts an additive SELECT toggle. Checked BEFORE the 4e
 * lift — crossing the threshold cancels the timer; once it has fired the
 * gesture can never lift.
 */
export const LONG_PRESS_MS = 350;

/** Stamped on the veil and every overlay layer so hit-testing can skip them. */
const LAYER_ATTR = 'data-composerx-layer';

/** Stacking: veil above the surface, below every indicator layer. */
const Z_VEIL = '999990';
const Z_HOVER = '999994';
const Z_SELECTION = '999995';
const Z_MARQUEE = '999996'; // rubber band + candidate highlights, above selection
const Z_DROP = '999998';
const Z_MOVE = '999999'; // move ghost + dimmed origin, above the drop indicators

const ACCENT = 'var(--brand-accent, #6d28d9)';
const ACCENT_FAINT = 'color-mix(in srgb, var(--brand-accent, #6d28d9) 45%, transparent)';
const ACCENT_WASH = 'color-mix(in srgb, var(--brand-accent, #6d28d9) 8%, transparent)';
/** 70% accent: hover outline, marquee candidate highlights, and the 4f secondary selection outlines. */
const ACCENT_SOFT = 'color-mix(in srgb, var(--brand-accent, #6d28d9) 70%, transparent)';
/** Fade-toward-background wash that dims the origin rect during a move. */
const ORIGIN_DIM = 'color-mix(in srgb, var(--a2ui-color-background, #faf9f7) 60%, transparent)';

const store: SurfaceStore = createStore();
let started = false;
let announced = false;
let mode: 'edit' | 'preview' = 'preview';
/** Primary selection (COMPOSERX_SET_SELECTION `id`, contract 4c). */
let selectedId: string | null = null;
/** Full selection list (SET_SELECTION `ids`, contract 4f); [] when absent (v3 payload). */
let selectedIds: string[] = [];
let veil: HTMLElement | null = null;
let hoverPoint: { x: number; y: number } | null = null;
let hoverFramePending = false;
let propSpecsCache: PropSpecsPayload | null = null;
let selectionObserver: ResizeObserver | null = null;
let observedElements: Element[] = [];
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();
const pendingFrames = new Set<number>();

/**
 * Veil gesture state (contracts 4e + 4f). One gesture at a time. Every
 * gesture starts at pointerdown and is discriminated by what was pressed:
 * a COMPONENT press can end as a quick click-select, an additive long-press
 * toggle, or the 4e move lift; a BACKGROUND press (deepest hit null) can end
 * as the deselect click or the 4f marquee.
 */
interface GestureBase {
  /** undefined when the environment delivers plain MouseEvents (jsdom). */
  pointerId: number | undefined;
  startX: number;
  startY: number;
  /**
   * True once pointer travel crossed MOVE_THRESHOLD_PX: the press became a
   * move lift (component) or a marquee (background).
   */
  active: boolean;
}
interface ComponentGesture extends GestureBase {
  kind: 'component';
  /** Deepest hit at pointerdown — the id a click/long-press SELECTs (4c/4f). */
  hitId: string;
  /**
   * Lift anchor (resolveLiftAnchor at pointerdown): the id a drag moves.
   * null = this press can never lift (the root, a slot-only occupant); the
   * click and long-press paths still apply.
   */
  moveId: string | null;
  componentType: string;
  /** Pending 4f long-press timer; cleared on threshold-cross/up/cancel. */
  longPressTimer: ReturnType<typeof setTimeout> | null;
  /**
   * True once the long-press fired (additive SELECT posted): the gesture is
   * consumed — capture is kept but movement is ignored, a lift can no longer
   * start, and the trailing click is suppressed.
   */
  longPressFired: boolean;
  originRect: Rect | null;
  /** Pointer offset inside the origin rect, so the ghost stays under the grab. */
  grabDx: number;
  grabDy: number;
}
interface BackgroundGesture extends GestureBase {
  kind: 'background';
}
type VeilGesture = ComponentGesture | BackgroundGesture;

let gesture: VeilGesture | null = null;
let movePoint: { x: number; y: number } | null = null;
let moveFramePending = false;
let marqueePoint: { x: number; y: number } | null = null;
let marqueeFramePending = false;
/**
 * Set when a move, marquee, or long-press starts: the gesture's trailing
 * click event must not post the click-derived COMPOSERX_SELECT (contracts
 * 4e/4f). One-shot, consumed by onVeilClick and reset on the next
 * pointerdown.
 */
let suppressClickOnce = false;

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
  // Contracts 4e/4f: once a move, marquee, or long-press has started, the
  // click-derived SELECT for that gesture is suppressed (a sub-threshold
  // quick press never sets the flag, so a plain click selects as before).
  if (suppressClickOnce) {
    suppressClickOnce = false;
    return;
  }
  const id = hitTestDeepest(event.clientX, event.clientY);
  // Contract 4f: shift-click on a component selects additively. The flag is
  // omitted (not false) on plain clicks so v3 hosts see byte-identical
  // payloads; a background (id null) click is always the plain deselect —
  // shift has no additive meaning there.
  if (id !== null && event.shiftKey) {
    postToParent({ type: COMPOSERX_SELECT, payload: { id, additive: true } });
    return;
  }
  postToParent({ type: COMPOSERX_SELECT, payload: { id } });
}

function onVeilPointerMove(event: PointerEvent): void {
  if (gesture !== null && gesture.pointerId === event.pointerId) {
    trackGesture(event.clientX, event.clientY);
    // An active move/marquee owns the pointer (no hover outline underneath),
    // and a fired long-press has consumed the gesture entirely.
    if (gesture !== null && (gesture.active || isFiredLongPress(gesture))) return;
  }
  hoverPoint = { x: event.clientX, y: event.clientY };
  if (hoverFramePending) return;
  hoverFramePending = true;
  scheduleFrame(() => {
    hoverFramePending = false;
    refreshHoverOutline();
  });
}

function isFiredLongPress(g: VeilGesture): boolean {
  return g.kind === 'component' && g.longPressFired;
}

function onVeilPointerLeave(): void {
  hoverPoint = null;
  clearLayer(HOVER_LAYER_ID);
}

/* ------------------------------------------------- canvas move (4e) -- */

function capturePointer(pointerId: number | undefined): void {
  if (veil === null || pointerId === undefined) return;
  if (typeof veil.setPointerCapture !== 'function') return;
  try {
    veil.setPointerCapture(pointerId);
  } catch {
    // Capture is a tracking optimization, not a requirement (jsdom lacks it).
  }
}

function releasePointer(pointerId: number | undefined): void {
  if (veil === null || pointerId === undefined) return;
  if (typeof veil.releasePointerCapture !== 'function') return;
  try {
    veil.releasePointerCapture(pointerId);
  } catch {
    // Already released (or never captured).
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

function onVeilPointerDown(event: PointerEvent): void {
  suppressClickOnce = false; // a fresh gesture always starts clean
  if (gesture !== null) return; // one gesture at a time (ignore extra pointers)
  if (event.button !== 0) return;
  const hitId = hitTestDeepest(event.clientX, event.clientY);
  if (hitId === null) {
    // Contract 4f: a BACKGROUND press arms the marquee candidate. A
    // sub-threshold pointerup stays the existing deselect click; crossing
    // the threshold starts the rubber band. No long-press timer — background
    // has no additive meaning.
    gesture = {
      kind: 'background',
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      active: false,
    };
    capturePointer(event.pointerId);
    return;
  }
  // Contract 4e lift anchor: climb from the deepest hit to the nearest
  // component whose parent reference is a children-array splice. The root
  // and slot-only occupants without such an ancestor can never lift
  // (moveId null) but still take the click and 4f long-press paths.
  const moveId = resolveLiftAnchor(store, hitId);
  const g: ComponentGesture = {
    kind: 'component',
    pointerId: event.pointerId,
    startX: event.clientX,
    startY: event.clientY,
    hitId,
    moveId,
    componentType: store.components.get(moveId ?? hitId)?.component ?? 'Component',
    active: false,
    longPressTimer: null,
    longPressFired: false,
    originRect: null,
    grabDx: 0,
    grabDy: 0,
  };
  gesture = g;
  // Contract 4f long-press: checked BEFORE the 4e lift. Armed for every
  // component press; cancelled the instant the threshold is crossed.
  g.longPressTimer = setTimeout(() => {
    g.longPressTimer = null;
    if (gesture !== g || g.active) return; // superseded (defensive)
    fireLongPress(g);
  }, LONG_PRESS_MS);
  // Capture immediately so threshold tracking survives leaving the iframe.
  capturePointer(event.pointerId);
}

function clearLongPress(g: VeilGesture): void {
  if (g.kind !== 'component' || g.longPressTimer === null) return;
  clearTimeout(g.longPressTimer);
  g.longPressTimer = null;
}

/**
 * Contract 4f: the press was held LONG_PRESS_MS without crossing the
 * threshold — post the additive SELECT toggle immediately and consume the
 * gesture. A long-press never turns into a lift: pointer capture is kept (so
 * no other element sees the tail of the gesture) but every subsequent
 * movement is ignored, and the trailing click is suppressed one-shot.
 */
function fireLongPress(g: ComponentGesture): void {
  g.longPressFired = true;
  suppressClickOnce = true;
  postToParent({ type: COMPOSERX_SELECT, payload: { id: g.hitId, additive: true } });
  renderAdditivePulse(g.hitId);
}

/** Haptic-style feedback for the 4f long-press: a brief accent pulse. */
function renderAdditivePulse(id: string): void {
  const rect = rectForComponent(id);
  if (rect === null) return;
  const layer = ensureLayer(MARQUEE_LAYER_ID, Z_MARQUEE);
  if (layer === null) return;
  const pulse = document.createElement('div');
  pulse.setAttribute('data-composerx-pulse', 'additive');
  positionBox(pulse, inflate(rect, 3));
  Object.assign(pulse.style, {
    borderStyle: 'solid',
    borderWidth: '2px',
    borderColor: ACCENT,
    borderRadius: '6px',
    backgroundColor: ACCENT_WASH,
    opacity: '1',
    transition: 'opacity 220ms ease-out',
  });
  layer.appendChild(pulse);
  later(() => {
    pulse.style.opacity = '0';
  }, 140);
  later(() => {
    pulse.remove();
  }, 380);
}

function trackGesture(x: number, y: number): void {
  const g = gesture;
  if (g === null) return;
  if (g.kind === 'component') {
    if (g.longPressFired) return; // consumed: a long-press never lifts (4f)
    if (!g.active) {
      if (Math.hypot(x - g.startX, y - g.startY) <= MOVE_THRESHOLD_PX) return;
      clearLongPress(g); // threshold crossed: the additive toggle is off the table
      if (g.moveId === null) {
        // Nothing to lift (v3 parity): the press dies quietly; the trailing
        // click still selects whatever ends up under the pointer.
        gesture = null;
        return;
      }
      startMove(g);
    }
    movePoint = { x, y };
    if (moveFramePending) return;
    moveFramePending = true;
    scheduleFrame(() => {
      moveFramePending = false;
      refreshMoveVisuals();
    });
    return;
  }
  // Background press: marquee (contract 4f).
  if (!g.active) {
    if (Math.hypot(x - g.startX, y - g.startY) <= MOVE_THRESHOLD_PX) return;
    startMarquee(g);
  }
  marqueePoint = { x, y };
  if (marqueeFramePending) return;
  marqueeFramePending = true;
  scheduleFrame(() => {
    marqueeFramePending = false;
    refreshMarqueeVisuals();
  });
}

function startMove(g: ComponentGesture): void {
  if (g.moveId === null) return; // guarded by the caller
  g.active = true;
  suppressClickOnce = true;
  g.originRect = rectForComponent(g.moveId);
  if (g.originRect !== null) {
    g.grabDx = clamp(g.startX - g.originRect.x, 0, g.originRect.width);
    g.grabDy = clamp(g.startY - g.originRect.y, 0, g.originRect.height);
  } else {
    g.grabDx = 24;
    g.grabDy = 16;
  }
  hoverPoint = null;
  clearLayer(HOVER_LAYER_ID);
  // Escape cancels mid-drag; the iframe owns focus during the gesture, so the
  // listener lives here (window, capture) and only while a move is active.
  window.addEventListener('keydown', onGestureKeyDown, true);
  postToParent({ type: COMPOSERX_MOVE_START, payload: { id: g.moveId } });
  renderMoveScaffold(g);
}

/** Ghost (follows the pointer) + dimmed dashed-outline origin rect. */
function renderMoveScaffold(g: ComponentGesture): void {
  const layer = ensureLayer(MOVE_LAYER_ID, Z_MOVE);
  if (layer === null) return;
  layer.replaceChildren();

  if (g.originRect !== null) {
    const origin = document.createElement('div');
    origin.setAttribute('data-composerx-move', 'origin');
    positionBox(origin, g.originRect);
    Object.assign(origin.style, {
      borderStyle: 'dashed',
      borderWidth: '1px',
      borderColor: ACCENT_FAINT,
      borderRadius: '6px',
      backgroundColor: ORIGIN_DIM,
    });
    layer.appendChild(origin);
  }

  const ghost = document.createElement('div');
  ghost.setAttribute('data-composerx-move', 'ghost');
  positionBox(ghost, {
    x: g.startX - g.grabDx,
    y: g.startY - g.grabDy,
    width: Math.max(24, g.originRect?.width ?? 120),
    height: Math.max(20, g.originRect?.height ?? 40),
  });
  Object.assign(ghost.style, {
    borderStyle: 'solid',
    borderWidth: '2px',
    borderColor: ACCENT,
    borderRadius: '6px',
    backgroundColor: ACCENT_WASH,
    opacity: '0.9',
    willChange: 'left, top',
  });
  const label = document.createElement('div');
  label.setAttribute('data-composerx-move', 'ghost-label');
  label.textContent = g.componentType;
  Object.assign(label.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    maxWidth: '100%',
    overflow: 'hidden',
    whiteSpace: 'nowrap',
    padding: '1px 6px',
    fontFamily: 'var(--brand-font, system-ui, sans-serif)',
    fontSize: '10px',
    fontWeight: '600',
    lineHeight: '14px',
    color: 'var(--brand-on-accent, #ffffff)',
    backgroundColor: ACCENT,
    borderRadius: '4px 0px 4px 0px',
  });
  ghost.appendChild(label);
  layer.appendChild(ghost);
}

function positionGhost(x: number, y: number): void {
  const g = gesture;
  if (g === null || g.kind !== 'component') return;
  const ghost = document
    .getElementById(MOVE_LAYER_ID)
    ?.querySelector('[data-composerx-move="ghost"]') as HTMLElement | null;
  if (!ghost) return;
  ghost.style.left = `${x - g.grabDx}px`;
  ghost.style.top = `${y - g.grabDy}px`;
}

/**
 * The section-4b indicators driven by the same hit-test path as DND_HOVER,
 * with the moved subtree excluded from resolution (contract 4e) — indices
 * come out relative to the target's children AFTER the moved id's removal.
 */
function resolveMoveTarget(x: number, y: number, moveId: string): DropTarget {
  return resolveDropTarget({
    x,
    y,
    hitId: hitTestDeepest(x, y),
    store,
    getRect: rectForComponent,
    viewport: viewportRect(),
    excludeSubtree: moveId,
  });
}

/** rAF-throttled: ghost position + drop indicator for the latest pointer. */
function refreshMoveVisuals(): void {
  const g = gesture;
  if (g === null || g.kind !== 'component' || !g.active || movePoint === null) return;
  if (g.moveId === null) return; // unreachable: active implies a lift anchor
  positionGhost(movePoint.x, movePoint.y);
  drawIndicator(resolveMoveTarget(movePoint.x, movePoint.y, g.moveId));
}

/** Clears everything a move drew; never touches the selection outline. */
function clearMoveVisuals(): void {
  window.removeEventListener('keydown', onGestureKeyDown, true);
  movePoint = null;
  clearLayer(MOVE_LAYER_ID);
  clearIndicator();
}

/* -------------------------------------------------- marquee (4f) -- */

/** Normalized marquee rect between the gesture origin and the pointer. */
function marqueeRectFrom(g: GestureBase, x: number, y: number): Rect {
  return {
    x: Math.min(g.startX, x),
    y: Math.min(g.startY, y),
    width: Math.abs(x - g.startX),
    height: Math.abs(y - g.startY),
  };
}

/**
 * Contract 4f: the background press crossed the threshold — the rubber band
 * starts. The trailing click is suppressed (the gesture now ends in a
 * MARQUEE post or a silent abort, never the deselect click).
 */
function startMarquee(g: BackgroundGesture): void {
  g.active = true;
  suppressClickOnce = true;
  hoverPoint = null;
  clearLayer(HOVER_LAYER_ID);
  // Escape aborts mid-marquee; same listener lifecycle as the move gesture.
  window.addEventListener('keydown', onGestureKeyDown, true);
}

/**
 * rAF-throttled: redraws the rubber band (SOLID 1px accent border, ~8%
 * accent wash — dashed is reserved for drop indicators, contract 4b/4f) and
 * the live candidate highlights (light solid outlines) for the latest
 * pointer. Rects are measured once per frame per id.
 */
function refreshMarqueeVisuals(): void {
  const g = gesture;
  if (g === null || g.kind !== 'background' || !g.active || marqueePoint === null) return;
  const layer = ensureLayer(MARQUEE_LAYER_ID, Z_MARQUEE);
  if (layer === null) return;
  layer.replaceChildren();
  const rect = marqueeRectFrom(g, marqueePoint.x, marqueePoint.y);
  const rectCache = new Map<string, Rect | null>();
  const getRect = (id: string): Rect | null => {
    let cached = rectCache.get(id);
    if (cached === undefined) {
      cached = rectForComponent(id);
      rectCache.set(id, cached);
    }
    return cached;
  };
  for (const id of marqueeCandidates(store, getRect, rect)) {
    const candidateRect = getRect(id);
    if (candidateRect === null) continue;
    const box = document.createElement('div');
    box.setAttribute('data-composerx-marquee', 'candidate');
    positionBox(box, inflate(candidateRect, 1));
    Object.assign(box.style, {
      borderStyle: 'solid',
      borderWidth: '1.5px',
      borderColor: ACCENT_SOFT,
      borderRadius: '4px',
    });
    layer.appendChild(box);
  }
  const band = document.createElement('div');
  band.setAttribute('data-composerx-marquee', 'band');
  positionBox(band, rect);
  Object.assign(band.style, {
    borderStyle: 'solid',
    borderWidth: '1px',
    borderColor: ACCENT,
    backgroundColor: ACCENT_WASH,
  });
  layer.appendChild(band);
}

/** Clears everything a marquee drew; never touches the selection outline. */
function clearMarqueeVisuals(): void {
  window.removeEventListener('keydown', onGestureKeyDown, true);
  marqueePoint = null;
  clearLayer(MARQUEE_LAYER_ID);
}

function onVeilPointerUp(event: PointerEvent): void {
  const g = gesture;
  if (g === null || g.pointerId !== event.pointerId) return;
  releasePointer(event.pointerId);
  gesture = null;
  clearLongPress(g);
  // Sub-threshold press: the trailing click handles it — plain/shift SELECT
  // (component), SELECT {id:null} deselect (background) — unless a fired
  // long-press already posted the additive SELECT and suppressed the click.
  if (!g.active) return;
  if (g.kind === 'background') {
    // Contract 4f: pointerup ends the marquee — re-resolve the candidates at
    // the final rect (the rAF-throttled visuals may lag a frame) and post
    // them ([] when nothing intersects).
    clearMarqueeVisuals();
    const ids = marqueeCandidates(
      store,
      rectForComponent,
      marqueeRectFrom(g, event.clientX, event.clientY),
    );
    postToParent({ type: COMPOSERX_MARQUEE, payload: { ids } });
    return;
  }
  if (g.moveId === null) return; // unreachable: active implies a lift anchor
  clearMoveVisuals();
  // Re-resolve at the drop point (the rAF-throttled state may lag a frame).
  const target = resolveMoveTarget(event.clientX, event.clientY, g.moveId);
  if (target.containerId !== null && target.index !== null && target.slot !== null) {
    postToParent({
      type: COMPOSERX_MOVE_DROP,
      payload: {
        id: g.moveId,
        containerId: target.containerId,
        index: target.index,
        slot: target.slot,
      },
    });
  } else {
    postToParent({ type: COMPOSERX_MOVE_CANCEL, payload: { id: g.moveId } });
  }
}

function onVeilPointerCancel(event: PointerEvent): void {
  if (gesture === null || gesture.pointerId !== event.pointerId) return;
  releasePointer(event.pointerId);
  cancelActiveGesture();
}

/**
 * Drops the in-flight gesture (clearing any pending long-press timer). For a
 * move that had actually started (threshold crossed) it posts MOVE_CANCEL
 * (unless `post` is false); an aborted marquee is always SILENT — visuals
 * clear, no message (contract 4f). Safe to call when nothing is in flight.
 */
function cancelActiveGesture(post = true): void {
  const g = gesture;
  gesture = null;
  if (g === null) return;
  clearLongPress(g);
  if (!g.active) return;
  if (g.kind === 'background') {
    clearMarqueeVisuals();
    return;
  }
  clearMoveVisuals();
  if (post) postToParent({ type: COMPOSERX_MOVE_CANCEL, payload: { id: g.moveId } });
}

/** Active only while a move or marquee is in flight (added on start). */
function onGestureKeyDown(event: KeyboardEvent): void {
  if (event.key !== 'Escape') return;
  event.preventDefault();
  event.stopPropagation();
  cancelActiveGesture();
}

function ensureVeil(): HTMLElement | null {
  if (typeof document === 'undefined' || !document.body) return null;
  if (veil === null) {
    veil = document.createElement('div');
    veil.id = EDIT_VEIL_ID;
    veil.setAttribute(LAYER_ATTR, '');
    // Transparent, full-viewport, pointer-events:auto: swallows every pointer
    // interaction with the rendered surface while in edit mode. position:fixed
    // keeps it out of SURFACE_RESIZE measurements. touch-action/user-select
    // none keep native scroll/selection gestures from hijacking a canvas move.
    Object.assign(veil.style, {
      position: 'fixed',
      inset: '0',
      backgroundColor: 'transparent',
      cursor: 'default',
      pointerEvents: 'auto',
      touchAction: 'none',
      userSelect: 'none',
      zIndex: Z_VEIL,
    });
    veil.addEventListener('click', onVeilClick);
    veil.addEventListener('pointerdown', onVeilPointerDown);
    veil.addEventListener('pointermove', onVeilPointerMove);
    veil.addEventListener('pointerup', onVeilPointerUp);
    veil.addEventListener('pointercancel', onVeilPointerCancel);
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
    // Leaving edit mid-gesture posts MOVE_CANCEL for a lifted move (4e);
    // an in-flight marquee aborts silently (4f).
    cancelActiveGesture();
    removeVeil();
    hoverPoint = null;
    clearLayer(HOVER_LAYER_ID);
  }
  document.documentElement.classList.toggle(EDIT_MODE_CLASS, mode === 'edit');
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
  const rawIds = (payload as { ids?: unknown }).ids;
  selectedId = id;
  // Contract 4f: `ids` is the full selection list (primary included). A v3
  // payload without `ids` stores [] and behaves exactly as before.
  selectedIds = Array.isArray(rawIds)
    ? rawIds.filter((value): value is string => typeof value === 'string')
    : [];
  refreshSelectionOutline();
}

function observeSelected(elements: Element[]): void {
  if (typeof ResizeObserver === 'undefined') return;
  if (
    elements.length === observedElements.length &&
    elements.every((element, index) => element === observedElements[index])
  ) {
    return;
  }
  selectionObserver?.disconnect();
  observedElements = elements;
  if (elements.length === 0) return;
  selectionObserver ??= new ResizeObserver(() => refreshSelectionOutline());
  for (const element of elements) selectionObserver.observe(element);
}

/**
 * Draws (or clears) the solid selection outlines for the current mode +
 * selection list (contracts 4c + 4f): the primary (`id`) gets the 2px solid
 * accent outline (1px offset), every other id in `ids` a lighter 1.5px /
 * 70%-accent outline. Measures by id at call time, so calling it again
 * re-anchors; ids that no longer render are dropped individually. Boxes are
 * keyed by component id and reused across refreshes (scroll/resize/observer
 * churn), with the primary kept first in the layer.
 */
function refreshSelectionOutline(): void {
  if (typeof document === 'undefined' || !document.body) return;
  const wanted: { id: string; primary: boolean }[] = [];
  if (mode === 'edit') {
    if (selectedId !== null) wanted.push({ id: selectedId, primary: true });
    for (const id of selectedIds) {
      if (id !== selectedId && !wanted.some((entry) => entry.id === id)) {
        wanted.push({ id, primary: false });
      }
    }
  }
  const entries: { id: string; primary: boolean; wrapper: Element; rect: Rect }[] = [];
  for (const { id, primary } of wanted) {
    const wrapper = wrapperFor(id);
    if (wrapper === null) continue; // no longer renders: dropped individually
    // jsdom (and a component rendering no boxes) yields no union rect; fall
    // back to the wrapper's own bounding rect so the outline still exists.
    entries.push({ id, primary, wrapper, rect: unionRectOf(wrapper) ?? domRectOf(wrapper) });
  }
  if (entries.length === 0) {
    clearLayer(SELECTION_LAYER_ID);
    observeSelected([]);
    return;
  }
  const layer = ensureLayer(SELECTION_LAYER_ID, Z_SELECTION);
  if (layer === null) return;
  const previous = new Map<string, HTMLElement>();
  for (const child of Array.from(layer.children)) {
    const key = child.getAttribute('data-composerx-outline-id');
    if (key !== null && !previous.has(key)) previous.set(key, child as HTMLElement);
  }
  const kept = new Set<Element>();
  for (const entry of entries) {
    let box = previous.get(entry.id) ?? null;
    if (box === null) {
      box = document.createElement('div');
      box.setAttribute('data-composerx-outline-id', entry.id);
    }
    box.setAttribute('data-composerx-outline', entry.primary ? 'selection' : 'selection-secondary');
    if (entry.primary) {
      // Solid 2px accent outline with a 1px offset (contract 4c): the drawn
      // box is the component rect inflated by 3px (1px gap + 2px border).
      Object.assign(box.style, {
        borderStyle: 'solid',
        borderWidth: '2px',
        borderColor: ACCENT,
        borderRadius: '6px',
      });
      positionBox(box, inflate(entry.rect, 3));
    } else {
      // Contract 4f secondary: 1.5px solid at 70% accent, same 1px offset
      // (rect inflated by 2.5px = 1px gap + 1.5px border).
      Object.assign(box.style, {
        borderStyle: 'solid',
        borderWidth: '1.5px',
        borderColor: ACCENT_SOFT,
        borderRadius: '6px',
      });
      positionBox(box, inflate(entry.rect, 2.5));
    }
    layer.appendChild(box); // appends new boxes and re-orders reused ones
    kept.add(box);
  }
  for (const child of Array.from(layer.children)) {
    if (!kept.has(child)) child.remove();
  }
  observeSelected(
    entries
      .map((entry) => entry.wrapper.firstElementChild)
      .filter((element): element is Element => element !== null),
  );
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
      borderColor: ACCENT_SOFT,
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
      // A re-render invalidates the mirrored tree an in-flight move or
      // marquee is resolving against — cancel it (the composer treats a
      // MOVE_CANCEL as a no-op; a marquee aborts silently).
      cancelActiveGesture();
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
    window.removeEventListener('keydown', onGestureKeyDown, true);
    document.removeEventListener('focusin', onFocusIn, true);
  }
  if (gesture !== null) clearLongPress(gesture);
  gesture = null;
  movePoint = null;
  moveFramePending = false;
  marqueePoint = null;
  marqueeFramePending = false;
  suppressClickOnce = false;
  for (const id of pendingTimers) clearTimeout(id);
  pendingTimers.clear();
  if (typeof cancelAnimationFrame === 'function') {
    for (const id of pendingFrames) cancelAnimationFrame(id);
  }
  pendingFrames.clear();
  selectionObserver?.disconnect();
  selectionObserver = null;
  observedElements = [];
  veil?.remove();
  veil = null;
  started = false;
  announced = false;
  mode = 'edit';
  selectedId = null;
  selectedIds = [];
  hoverPoint = null;
  hoverFramePending = false;
  store.surfaceId = null;
  store.components = new Map();
  for (const id of [
    DROP_INDICATOR_LAYER_ID,
    HOVER_LAYER_ID,
    SELECTION_LAYER_ID,
    MARQUEE_LAYER_ID,
    MOVE_LAYER_ID,
  ]) {
    document.getElementById(id)?.remove();
  }
}

/** Test hook: whether the ready announcement has been posted. */
export function hasAnnouncedSidecarReady(): boolean {
  return announced;
}
