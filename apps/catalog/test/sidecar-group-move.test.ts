/**
 * Sidecar v5 group move (contract section 4e, "Group move", feature
 * 'group-move'): pressing a member of the current multi-selection lifts the
 * whole selection. Covers the group-lift decision against the stored
 * SET_SELECTION ids, the ids-carrying MOVE_START/MOVE_DROP payloads (and
 * their byte-identical v4 shape when the lift stays single), the per-member
 * origin dims + count-labeled ghost, the union subtree exclusion (both at
 * the pure resolveDropTarget level and through the DOM gesture), and the
 * unchanged MOVE_CANCEL / long-press timing. Same jsdom window.parent
 * stubbing pattern as sidecar-move.test.ts — hand-built `[data-a2ui-id]`
 * DOM, stubbed rects, and a coordinate-aware document.elementsFromPoint
 * stub; pointer events dispatched as MouseEvents.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSERX_MOVE_CANCEL,
  COMPOSERX_MOVE_DROP,
  COMPOSERX_MOVE_START,
  COMPOSERX_SELECT,
  COMPOSERX_SET_MODE,
  COMPOSERX_SET_SELECTION,
  DROP_INDICATOR_LAYER_ID,
  EDIT_VEIL_ID,
  LONG_PRESS_MS,
  MOVE_LAYER_ID,
  SIDECAR_FEATURES,
  SIDECAR_VERSION,
  destroyComposerxSidecar,
  initComposerxSidecar,
} from '../src/sidecar';
import {
  applyRenderItems,
  createStore,
  resolveDropTarget,
  type Rect,
  type SurfaceStore,
} from '../src/sidecar-math';

describe('sidecar v5 announcement constants (contract section 4)', () => {
  it('announces version 5 with group-move appended in contract order', () => {
    expect(SIDECAR_VERSION).toBe(5);
    expect([...SIDECAR_FEATURES]).toEqual([
      'dnd-hittest',
      'select',
      'prop-specs',
      'move',
      'multi-select',
      'group-move',
    ]);
  });
});

/* ------------------------------------------------------------------------ */
/* Pure math: resolveDropTarget with a LIST excludeSubtree (contract 4e).   */
/* Same synthetic layout as sidecar-math.test.ts:                           */
/*                                                                          */
/*   root Column (0,0 300x300)                                              */
/*     text-1  (10, 10, 280x40)                                             */
/*     row-1   (10, 60, 280x100)  Row children [text-2, text-3]             */
/*     card-1  (10, 170, 280x80)  Card (child: text-4)                      */
/* ------------------------------------------------------------------------ */

const MATH_COMPONENTS = [
  { id: 'root', component: 'Column', children: ['text-1', 'row-1', 'card-1'] },
  { id: 'text-1', component: 'Text', text: 'a' },
  { id: 'row-1', component: 'Row', children: ['text-2', 'text-3'] },
  { id: 'text-2', component: 'Text', text: 'b' },
  { id: 'text-3', component: 'Text', text: 'c' },
  { id: 'card-1', component: 'Card', child: 'text-4' },
  { id: 'text-4', component: 'Text', text: 'd' },
];

const MATH_RECTS: Record<string, Rect> = {
  root: { x: 0, y: 0, width: 300, height: 300 },
  'text-1': { x: 10, y: 10, width: 280, height: 40 },
  'row-1': { x: 10, y: 60, width: 280, height: 100 },
  'text-2': { x: 20, y: 70, width: 80, height: 80 },
  'text-3': { x: 120, y: 70, width: 80, height: 80 },
  'card-1': { x: 10, y: 170, width: 280, height: 80 },
  'text-4': { x: 20, y: 180, width: 260, height: 60 },
};

const MATH_VIEWPORT: Rect = { x: 0, y: 0, width: 300, height: 300 };

function mathStore(): SurfaceStore {
  const store = createStore();
  applyRenderItems(store, [
    { version: 'v0.9', createSurface: { surfaceId: 'composer-canvas', catalogId: 'urn:test' } },
    {
      version: 'v0.9',
      updateComponents: { surfaceId: 'composer-canvas', components: MATH_COMPONENTS },
    },
  ]);
  return store;
}

function resolveMath(
  x: number,
  y: number,
  hitId: string | null,
  excludeSubtree?: string | readonly string[],
) {
  return resolveDropTarget({
    x,
    y,
    hitId,
    store: mathStore(),
    getRect: (id) => MATH_RECTS[id] ?? null,
    viewport: MATH_VIEWPORT,
    ...(excludeSubtree === undefined ? {} : { excludeSubtree }),
  });
}

describe('resolveDropTarget with a list excludeSubtree (contract 4e group move)', () => {
  it('excludes the UNION of every listed subtree: background hover appends after all removals', () => {
    // Without exclusion the background hover at the bottom is index 3; with
    // row-1 AND card-1 gone the filtered children are [text-1] -> index 1.
    const target = resolveMath(150, 290, null, ['row-1', 'card-1']);
    expect(target).toMatchObject({ containerId: 'root', slot: 'into', index: 1 });
  });

  it('a hit inside ANY moved subtree resolves as if those nodes were absent', () => {
    // text-2 sits in moved row-1: the hit climbs out to root.
    const viaRow = resolveMath(90, 100, 'text-2', ['row-1', 'card-1']);
    expect(viaRow).toMatchObject({ targetId: 'root', containerId: 'root', slot: 'into', index: 1 });

    // text-4 sits in the OTHER moved subtree (card-1): same parent context.
    const viaCard = resolveMath(150, 240, 'text-4', ['row-1', 'card-1']);
    expect(viaCard).toMatchObject({
      targetId: 'root',
      containerId: 'root',
      slot: 'into',
      index: 1,
    });
  });

  it('hovering a surviving leaf yields before/after with an all-removed index', () => {
    // Filtered root children are [text-1]; below its midpoint (30) -> after,
    // index 1 (instead of 1..3 shifting with row-1/card-1 present).
    const target = resolveMath(150, 45, 'text-1', ['row-1', 'card-1']);
    expect(target).toMatchObject({
      targetId: 'text-1',
      containerId: 'root',
      slot: 'after',
      index: 1,
    });
  });

  it('a member nested inside another member adds nothing: [ancestor, descendant] === [ancestor]', () => {
    // text-4 is card-1's slot child; climbing from the hit passes THROUGH the
    // excluded descendant and its excluded ancestor alike.
    const nested = resolveMath(150, 240, 'text-4', ['card-1', 'text-4']);
    const ancestorOnly = resolveMath(150, 240, 'text-4', 'card-1');
    expect(nested).toEqual(ancestorOnly);
    expect(nested).toMatchObject({ containerId: 'root', slot: 'into', index: 2 });
  });

  it('a single-element list behaves exactly like the string form', () => {
    const asList = resolveMath(15, 175, 'card-1', ['row-1']);
    const asString = resolveMath(15, 175, 'card-1', 'row-1');
    expect(asList).toEqual(asString);
    expect(asList).toMatchObject({ containerId: 'root', slot: 'before', index: 1 });
  });

  it('an empty list and unknown-only ids behave exactly like no exclusion', () => {
    const plain = resolveMath(150, 55, 'root');
    expect(resolveMath(150, 55, 'root', [])).toEqual(plain);
    expect(resolveMath(150, 55, 'root', ['no-such-id', 'nope'])).toEqual(plain);
  });

  it('unknown ids mixed into a real list are ignored for exclusion', () => {
    const withJunk = resolveMath(150, 290, null, ['row-1', 'ghost-9', 'card-1']);
    const clean = resolveMath(150, 290, null, ['row-1', 'card-1']);
    expect(withJunk).toEqual(clean);
  });

  it('no moved container in the list can be its own target', () => {
    const target = resolveMath(150, 110, 'row-1', ['row-1', 'card-1']);
    expect(target.containerId).toBe('root');
    expect(target).toMatchObject({ slot: 'into', index: 1 });
  });
});

/* ------------------------------------------------------------------------ */
/* DOM gesture: the group lift on the edit veil.                            */
/* Surface mirrored from RENDER_A2UI and mirrored in the DOM:               */
/*                                                                          */
/*   root Column (0,0 300x300) children [text-1, text-2, button-1]          */
/*     text-1       (10, 10, 280x40)                                        */
/*     text-2       (10, 60, 280x40)                                        */
/*     button-1     (10, 110, 100x40)  Button (child: button-label)         */
/*       button-label (20, 120, 80x20)                                      */
/* ------------------------------------------------------------------------ */

const RENDER_PAYLOAD = [
  {
    version: 'v0.9',
    createSurface: {
      surfaceId: 'composer-canvas',
      catalogId: 'https://a2ui.org/specification/v0_9/basic_catalog.json',
    },
  },
  {
    version: 'v0.9',
    updateComponents: {
      surfaceId: 'composer-canvas',
      components: [
        { id: 'root', component: 'Column', children: ['text-1', 'text-2', 'button-1'] },
        { id: 'text-1', component: 'Text', text: 'Welcome' },
        { id: 'text-2', component: 'Text', text: 'Details' },
        { id: 'button-1', component: 'Button', child: 'button-label' },
        { id: 'button-label', component: 'Text', text: 'Go' },
      ],
    },
  },
];

const RECTS: Record<string, Rect> = {
  root: { x: 0, y: 0, width: 300, height: 300 },
  'text-1': { x: 10, y: 10, width: 280, height: 40 },
  'text-2': { x: 10, y: 60, width: 280, height: 40 },
  'button-1': { x: 10, y: 110, width: 100, height: 40 },
  'button-label': { x: 20, y: 120, width: 80, height: 20 },
};

function wrapSpan(id: string, component: string): HTMLElement {
  const span = document.createElement('span');
  span.style.display = 'contents';
  span.setAttribute('data-a2ui-id', id);
  span.setAttribute('data-a2ui-component', component);
  return span;
}

function stubRect(element: Element, rect: Rect): void {
  const domRect = {
    x: rect.x,
    y: rect.y,
    width: rect.width,
    height: rect.height,
    top: rect.y,
    left: rect.x,
    right: rect.x + rect.width,
    bottom: rect.y + rect.height,
    toJSON: () => rect,
  } as DOMRect;
  (element as HTMLElement).getBoundingClientRect = () => domRect;
  (element as HTMLElement).getClientRects = () => [domRect] as unknown as DOMRectList;
}

function within(rect: Rect, x: number, y: number): boolean {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

/** Builds the DOM tree, stubs its rects, and installs a coordinate-aware elementsFromPoint. */
function buildSurface() {
  const main = document.createElement('main');
  main.className = 'sandbox-shell';
  const rootWrap = wrapSpan('root', 'Column');
  const rootBox = document.createElement('div');
  const text1Wrap = wrapSpan('text-1', 'Text');
  const text1 = document.createElement('p');
  text1.textContent = 'Welcome';
  const text2Wrap = wrapSpan('text-2', 'Text');
  const text2 = document.createElement('p');
  text2.textContent = 'Details';
  const buttonWrap = wrapSpan('button-1', 'Button');
  const button = document.createElement('button');
  const labelWrap = wrapSpan('button-label', 'Text');
  const label = document.createElement('em');
  label.textContent = 'Go';
  labelWrap.appendChild(label);
  button.appendChild(labelWrap);
  buttonWrap.appendChild(button);
  text1Wrap.appendChild(text1);
  text2Wrap.appendChild(text2);
  rootBox.appendChild(text1Wrap);
  rootBox.appendChild(text2Wrap);
  rootBox.appendChild(buttonWrap);
  rootWrap.appendChild(rootBox);
  main.appendChild(rootWrap);
  document.body.appendChild(main);

  stubRect(rootBox, RECTS['root']!);
  stubRect(text1, RECTS['text-1']!);
  stubRect(text2, RECTS['text-2']!);
  stubRect(button, RECTS['button-1']!);
  stubRect(label, RECTS['button-label']!);

  document.elementsFromPoint = (x: number, y: number) => {
    const stack: Element[] = [];
    const veil = document.getElementById(EDIT_VEIL_ID);
    if (veil !== null) stack.push(veil);
    if (within(RECTS['button-label']!, x, y)) stack.push(label, button);
    else if (within(RECTS['button-1']!, x, y)) stack.push(button);
    else if (within(RECTS['text-2']!, x, y)) stack.push(text2);
    else if (within(RECTS['text-1']!, x, y)) stack.push(text1);
    if (within(RECTS['root']!, x, y)) stack.push(rootBox);
    stack.push(document.body);
    return stack;
  };
  return { main, rootBox, text1, text2, button, label };
}

function veilElement(): HTMLElement | null {
  return document.getElementById(EDIT_VEIL_ID);
}

function moveLayer(): HTMLElement | null {
  return document.getElementById(MOVE_LAYER_ID);
}

function postFromHost(data: unknown, origin = window.location.origin): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, origin, data }));
}

function pointer(type: string, x: number, y: number, target: EventTarget = veilElement()!): void {
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }));
}

type PostSpy = ReturnType<typeof vi.fn> & {
  mock: { calls: [message: { type: string; payload?: unknown }, targetOrigin: string][] };
};

function typesOf(spy: PostSpy): string[] {
  return spy.mock.calls.map((call) => call[0].type);
}

function payloadsOf(spy: PostSpy, type: string): Record<string, unknown>[] {
  return spy.mock.calls
    .filter((call) => call[0].type === type)
    .map((call) => call[0].payload as Record<string, unknown>);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('ComposerX sidecar v5: group move gesture (contract 4e group move)', () => {
  let originalParent: Window;
  let postSpy: PostSpy;

  beforeEach(() => {
    originalParent = window.parent;
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
    initComposerxSidecar();
    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'edit' } });
    postFromHost({ type: 'RENDER_A2UI', payload: RENDER_PAYLOAD });
    buildSurface();
    postSpy = vi.spyOn(window.parent, 'postMessage') as unknown as PostSpy;
  });

  afterEach(() => {
    destroyComposerxSidecar();
    vi.useRealTimers();
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    document.body.replaceChildren();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: originalParent,
    });
    vi.restoreAllMocks();
  });

  it('lifting a selection member lifts the group: MOVE_START and MOVE_DROP carry the stored ids', async () => {
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'text-1', ids: ['text-1', 'button-1'] },
    });

    pointer('pointerdown', 30, 125); // on the label: anchor button-1, a member
    pointer('pointermove', 150, 290); // far past the ~5px threshold

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MOVE_START, payload: { id: 'button-1', ids: ['text-1', 'button-1'] } },
      window.location.origin,
    );

    // Group visuals: count-labeled ghost + one dashed dim box PER moved id.
    await settle();
    const layer = moveLayer()!;
    const ghostLabel = layer.querySelector('[data-composerx-move="ghost-label"]') as HTMLElement;
    expect(ghostLabel.textContent).toBe('2 components');
    const origins = Array.from(
      layer.querySelectorAll('[data-composerx-move="origin"]'),
    ) as HTMLElement[];
    expect(origins).toHaveLength(2);
    const byId = new Map(origins.map((box) => [box.getAttribute('data-composerx-move-id'), box]));
    const textOrigin = byId.get('text-1')!;
    expect(textOrigin.style.left).toBe('10px');
    expect(textOrigin.style.top).toBe('10px');
    expect(textOrigin.style.borderStyle).toBe('dashed');
    const buttonOrigin = byId.get('button-1')!;
    expect(buttonOrigin.style.left).toBe('10px');
    expect(buttonOrigin.style.top).toBe('110px');
    expect(buttonOrigin.style.borderStyle).toBe('dashed');

    pointer('pointerup', 150, 290); // background inside root, below everything
    pointer('click', 150, 290);

    // Excluded view removes text-1 AND button-1: root's children collapse to
    // [text-2] (mid y=80), pointer below it -> index 1 = the position after
    // ALL moved ids are removed. The DROP repeats the exact MOVE_START ids.
    expect(postSpy).toHaveBeenCalledWith(
      {
        type: COMPOSERX_MOVE_DROP,
        payload: {
          id: 'button-1',
          containerId: 'root',
          index: 1,
          slot: 'into',
          ids: ['text-1', 'button-1'],
        },
      },
      window.location.origin,
    );
    const types = typesOf(postSpy);
    expect(types).not.toContain(COMPOSERX_SELECT); // suppressed for the gesture
    expect(types).not.toContain(COMPOSERX_MOVE_CANCEL);
    // Every move visual clears on drop.
    expect(moveLayer()!.childElementCount).toBe(0);
    expect(document.getElementById(DROP_INDICATOR_LAYER_ID)!.childElementCount).toBe(0);
  });

  it('lifting a NON-member keeps the single move: byte-identical v4 payloads, no ids key', () => {
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'text-1', ids: ['text-1', 'text-2'] },
    });

    pointer('pointerdown', 30, 125); // anchor button-1 is NOT in the stored ids
    pointer('pointermove', 150, 20);
    pointer('pointerup', 150, 20); // over text-1's upper half
    pointer('click', 150, 20);

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MOVE_START, payload: { id: 'button-1' } },
      window.location.origin,
    );
    expect(postSpy).toHaveBeenCalledWith(
      {
        type: COMPOSERX_MOVE_DROP,
        payload: { id: 'button-1', containerId: 'root', index: 0, slot: 'before' },
      },
      window.location.origin,
    );
    // A v4 composer must see IDENTICAL messages: no ids key at all.
    const [start] = payloadsOf(postSpy, COMPOSERX_MOVE_START);
    const [drop] = payloadsOf(postSpy, COMPOSERX_MOVE_DROP);
    expect('ids' in start!).toBe(false);
    expect('ids' in drop!).toBe(false);
  });

  it('a stored list with a single entry never group-lifts, even for its own member', async () => {
    postFromHost({ type: COMPOSERX_SET_SELECTION, payload: { id: 'button-1', ids: ['button-1'] } });

    pointer('pointerdown', 30, 125);
    pointer('pointermove', 150, 20);

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MOVE_START, payload: { id: 'button-1' } },
      window.location.origin,
    );
    const [start] = payloadsOf(postSpy, COMPOSERX_MOVE_START);
    expect('ids' in start!).toBe(false);

    // Single-move visuals are unchanged: type-labeled ghost, ONE origin dim.
    await settle();
    const layer = moveLayer()!;
    expect(layer.querySelector('[data-composerx-move="ghost-label"]')?.textContent).toBe('Button');
    expect(layer.querySelectorAll('[data-composerx-move="origin"]')).toHaveLength(1);

    pointer('pointerup', 150, 20);
    pointer('click', 150, 20);
  });

  it('dropping over a moved member resolves as if every moved node were absent', () => {
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'text-1', ids: ['text-1', 'text-2'] },
    });

    pointer('pointerdown', 150, 30); // on text-1 (anchor text-1, a member)
    pointer('pointermove', 150, 70); // 40px down: threshold crossed
    pointer('pointerup', 150, 70); // over text-2 — itself part of the group
    pointer('click', 150, 70);

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MOVE_START, payload: { id: 'text-1', ids: ['text-1', 'text-2'] } },
      window.location.origin,
    );
    // Hit on moved text-2 climbs out to root; excluded view leaves children
    // [button-1] (mid y=130), pointer above it -> 'into' root at index 0.
    expect(postSpy).toHaveBeenCalledWith(
      {
        type: COMPOSERX_MOVE_DROP,
        payload: {
          id: 'text-1',
          containerId: 'root',
          index: 0,
          slot: 'into',
          ids: ['text-1', 'text-2'],
        },
      },
      window.location.origin,
    );
  });

  it('a SET_SELECTION landing mid-drag never changes the in-flight group', () => {
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'text-1', ids: ['text-1', 'button-1'] },
    });
    pointer('pointerdown', 30, 125);
    pointer('pointermove', 150, 290);
    expect(typesOf(postSpy)).toContain(COMPOSERX_MOVE_START);

    // The composer re-selects mid-drag (it does after MOVE_START): the lift
    // keeps the ids it was started with.
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'button-1', ids: ['button-1', 'text-2'] },
    });
    pointer('pointerup', 150, 290);
    pointer('click', 150, 290);

    const [drop] = payloadsOf(postSpy, COMPOSERX_MOVE_DROP);
    expect(drop!['ids']).toEqual(['text-1', 'button-1']);
    expect(drop!['index']).toBe(1); // still resolved against the original exclusion
  });

  it('stored ids that no longer render still ride the payload verbatim; their dim is skipped', async () => {
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'text-1', ids: ['button-1', 'text-1', 'ghost-9'] },
    });

    pointer('pointerdown', 30, 125);
    pointer('pointermove', 150, 290);

    expect(postSpy).toHaveBeenCalledWith(
      {
        type: COMPOSERX_MOVE_START,
        payload: { id: 'button-1', ids: ['button-1', 'text-1', 'ghost-9'] },
      },
      window.location.origin,
    );
    await settle();
    const layer = moveLayer()!;
    expect(layer.querySelector('[data-composerx-move="ghost-label"]')?.textContent).toBe(
      '3 components',
    );
    // ghost-9 renders nowhere: only the two measurable origins dim.
    expect(layer.querySelectorAll('[data-composerx-move="origin"]')).toHaveLength(2);

    pointer('pointerup', 150, 290);
    pointer('click', 150, 290);
    const [drop] = payloadsOf(postSpy, COMPOSERX_MOVE_DROP);
    expect(drop!['ids']).toEqual(['button-1', 'text-1', 'ghost-9']);
    // The unknown id is ignored by the exclusion: children [text-2] -> 1.
    expect(drop!['index']).toBe(1);
  });

  it('Escape mid-group-drag posts the UNCHANGED MOVE_CANCEL ({id} only) and clears every visual', async () => {
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'text-1', ids: ['text-1', 'button-1'] },
    });
    pointer('pointerdown', 30, 125);
    pointer('pointermove', 150, 290);
    await settle();
    expect(moveLayer()!.childElementCount).toBeGreaterThan(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MOVE_CANCEL, payload: { id: 'button-1' } },
      window.location.origin,
    );
    const [cancel] = payloadsOf(postSpy, COMPOSERX_MOVE_CANCEL);
    expect('ids' in cancel!).toBe(false);
    expect(moveLayer()!.childElementCount).toBe(0);
    expect(document.getElementById(DROP_INDICATOR_LAYER_ID)!.childElementCount).toBe(0);

    pointer('pointerup', 150, 290);
    pointer('click', 150, 290);
    expect(typesOf(postSpy)).not.toContain(COMPOSERX_MOVE_DROP);
    expect(typesOf(postSpy)).not.toContain(COMPOSERX_SELECT);
  });

  it('long-press timing is untouched: a held group member still additive-toggles, never lifts', () => {
    vi.useFakeTimers();
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'text-1', ids: ['text-1', 'button-1'] },
    });

    pointer('pointerdown', 30, 125); // sub-threshold press on a group member
    vi.advanceTimersByTime(LONG_PRESS_MS + 1);

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: 'button-label', additive: true } },
      window.location.origin,
    );

    // Consumed: even a big post-fire drag can no longer lift the group.
    pointer('pointermove', 150, 290);
    pointer('pointerup', 150, 290);
    pointer('click', 150, 290);
    const types = typesOf(postSpy);
    expect(types).not.toContain(COMPOSERX_MOVE_START);
    expect(types).not.toContain(COMPOSERX_MOVE_DROP);
    expect(types).not.toContain(COMPOSERX_MOVE_CANCEL);
    expect(types.filter((type) => type === COMPOSERX_SELECT)).toHaveLength(1);
  });
});
