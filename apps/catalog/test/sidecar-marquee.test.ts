/**
 * Sidecar v4 marquee + multi-select (contract section 4f): the background
 * rubber band, the additive long-press / shift-click SELECT paths, and the
 * multi-outline SET_SELECTION payload. Same jsdom window.parent stubbing
 * pattern as sidecar-move.test.ts — hand-built `[data-a2ui-id]` DOM, stubbed
 * rects, and a coordinate-aware document.elementsFromPoint stub; pointer
 * events dispatched as MouseEvents (the sidecar never requires pointerId).
 * Long-press timing runs on vi.useFakeTimers; rAF-driven visuals use real
 * timers + a settle() wait like the move tests.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSERX_MARQUEE,
  COMPOSERX_MOVE_CANCEL,
  COMPOSERX_MOVE_DROP,
  COMPOSERX_MOVE_START,
  COMPOSERX_SELECT,
  COMPOSERX_SET_MODE,
  COMPOSERX_SET_SELECTION,
  EDIT_VEIL_ID,
  LONG_PRESS_MS,
  MARQUEE_LAYER_ID,
  SELECTION_LAYER_ID,
  destroyComposerxSidecar,
  initComposerxSidecar,
} from '../src/sidecar';
import type { Rect } from '../src/sidecar-math';

/**
 * Surface mirrored from RENDER_A2UI and mirrored in the DOM:
 *
 *   root Column (0,0 300x300) children [text-1, button-1]
 *     text-1       (10, 10, 280x40)
 *     button-1     (10, 60, 100x40)  Button (child: button-label)
 *       button-label (20, 70, 80x20)
 *
 * Background points sit at x > 300 (outside every rect, deepest hit null).
 */
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
        { id: 'root', component: 'Column', children: ['text-1', 'button-1'] },
        { id: 'text-1', component: 'Text', text: 'Welcome' },
        { id: 'button-1', component: 'Button', child: 'button-label' },
        { id: 'button-label', component: 'Text', text: 'Go' },
      ],
    },
  },
];

const RECTS: Record<string, Rect> = {
  root: { x: 0, y: 0, width: 300, height: 300 },
  'text-1': { x: 10, y: 10, width: 280, height: 40 },
  'button-1': { x: 10, y: 60, width: 100, height: 40 },
  'button-label': { x: 20, y: 70, width: 80, height: 20 },
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
  const textWrap = wrapSpan('text-1', 'Text');
  const text = document.createElement('p');
  text.textContent = 'Welcome';
  const buttonWrap = wrapSpan('button-1', 'Button');
  const button = document.createElement('button');
  const labelWrap = wrapSpan('button-label', 'Text');
  const label = document.createElement('em');
  label.textContent = 'Go';
  labelWrap.appendChild(label);
  button.appendChild(labelWrap);
  buttonWrap.appendChild(button);
  textWrap.appendChild(text);
  rootBox.appendChild(textWrap);
  rootBox.appendChild(buttonWrap);
  rootWrap.appendChild(rootBox);
  main.appendChild(rootWrap);
  document.body.appendChild(main);

  stubRect(rootBox, RECTS['root']!);
  stubRect(text, RECTS['text-1']!);
  stubRect(button, RECTS['button-1']!);
  stubRect(label, RECTS['button-label']!);

  document.elementsFromPoint = (x: number, y: number) => {
    const stack: Element[] = [];
    const veil = document.getElementById(EDIT_VEIL_ID);
    if (veil !== null) stack.push(veil);
    if (within(RECTS['button-label']!, x, y)) stack.push(label, button);
    else if (within(RECTS['button-1']!, x, y)) stack.push(button);
    else if (within(RECTS['text-1']!, x, y)) stack.push(text);
    if (within(RECTS['root']!, x, y)) stack.push(rootBox);
    stack.push(document.body);
    return stack;
  };
  return { main, rootBox, text, textWrap, button, buttonWrap, label };
}

function veilElement(): HTMLElement | null {
  return document.getElementById(EDIT_VEIL_ID);
}

function marqueeLayer(): HTMLElement | null {
  return document.getElementById(MARQUEE_LAYER_ID);
}

function selectionBoxes(): HTMLElement[] {
  return Array.from(document.getElementById(SELECTION_LAYER_ID)?.children ?? []) as HTMLElement[];
}

function postFromHost(data: unknown, origin = window.location.origin): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, origin, data }));
}

function pointer(
  type: string,
  x: number,
  y: number,
  init: MouseEventInit = {},
  target: EventTarget = veilElement()!,
): void {
  target.dispatchEvent(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true, ...init }));
}

type PostSpy = ReturnType<typeof vi.fn> & {
  mock: { calls: [message: { type: string; payload?: unknown }, targetOrigin: string][] };
};

function typesOf(spy: PostSpy): string[] {
  return spy.mock.calls.map((call) => call[0].type);
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ComposerX sidecar v4: marquee + additive select (contract 4f)', () => {
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

  it('long-press fires an additive SELECT at ~350ms, pulses, and never lifts', () => {
    vi.useFakeTimers();
    pointer('pointerdown', 30, 80); // on the button label

    vi.advanceTimersByTime(LONG_PRESS_MS - 1);
    expect(typesOf(postSpy)).not.toContain(COMPOSERX_SELECT);

    vi.advanceTimersByTime(2);
    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: 'button-label', additive: true } },
      window.location.origin,
    );
    // Haptic-style feedback: a brief accent pulse on the pressed component.
    const pulse = marqueeLayer()?.querySelector('[data-composerx-pulse]') as HTMLElement;
    expect(pulse).toBeTruthy();
    expect(pulse.style.borderStyle).toBe('solid');
    // button-label rect (20,70 80x20) inflated by 3.
    expect(pulse.style.left).toBe('17px');
    expect(pulse.style.top).toBe('67px');

    // The gesture is consumed: movement past the threshold no longer lifts,
    // and the trailing click is suppressed — exactly one SELECT total.
    pointer('pointermove', 150, 20);
    pointer('pointerup', 150, 20);
    pointer('click', 150, 20);
    const types = typesOf(postSpy);
    expect(types).not.toContain(COMPOSERX_MOVE_START);
    expect(types).not.toContain(COMPOSERX_MOVE_DROP);
    expect(types).not.toContain(COMPOSERX_MOVE_CANCEL);
    expect(types.filter((type) => type === COMPOSERX_SELECT)).toHaveLength(1);

    // The pulse cleans itself up.
    vi.advanceTimersByTime(500);
    expect(marqueeLayer()?.querySelector('[data-composerx-pulse]')).toBeNull();
  });

  it('crossing the threshold cancels the long-press timer: the lift wins, no additive SELECT', () => {
    vi.useFakeTimers();
    pointer('pointerdown', 30, 80);
    pointer('pointermove', 150, 20); // far past ~5px: MOVE_START, timer cancelled

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MOVE_START, payload: { id: 'button-1' } },
      window.location.origin,
    );
    vi.advanceTimersByTime(1000); // the long-press must never fire now
    expect(typesOf(postSpy)).not.toContain(COMPOSERX_SELECT);

    pointer('pointerup', 150, 20);
    pointer('click', 150, 20);
    const types = typesOf(postSpy);
    expect(types).toContain(COMPOSERX_MOVE_DROP);
    expect(types).not.toContain(COMPOSERX_SELECT);
  });

  it('a quick sub-threshold release beats the timer: plain SELECT, exactly once', () => {
    vi.useFakeTimers();
    pointer('pointerdown', 30, 80);
    vi.advanceTimersByTime(200); // released before LONG_PRESS_MS
    pointer('pointerup', 31, 81);
    pointer('click', 31, 81);

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: 'button-label' } },
      window.location.origin,
    );
    vi.advanceTimersByTime(1000); // the armed timer was cleared on pointerup
    const selects = typesOf(postSpy).filter((type) => type === COMPOSERX_SELECT);
    expect(selects).toHaveLength(1);
  });

  it('long-press works on non-liftable components too (root interior: additive SELECT, no lift)', () => {
    vi.useFakeTimers();
    pointer('pointerdown', 250, 250); // root's own area: lift anchor is null
    vi.advanceTimersByTime(LONG_PRESS_MS + 1);

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: 'root', additive: true } },
      window.location.origin,
    );
    pointer('pointerup', 250, 250);
    pointer('click', 250, 250);
    const types = typesOf(postSpy);
    expect(types).not.toContain(COMPOSERX_MOVE_START);
    expect(types.filter((type) => type === COMPOSERX_SELECT)).toHaveLength(1);
  });

  it('shift-click on a component posts an additive SELECT', () => {
    pointer('pointerdown', 30, 80, { shiftKey: true });
    pointer('pointerup', 30, 80, { shiftKey: true });
    pointer('click', 30, 80, { shiftKey: true });

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: 'button-label', additive: true } },
      window.location.origin,
    );
  });

  it('a plain quick click still posts the v3 payload (no additive key)', () => {
    pointer('pointerdown', 30, 80);
    pointer('pointermove', 32, 82); // ~2.8px, under the threshold
    pointer('pointerup', 32, 82);
    pointer('click', 32, 82);

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: 'button-label' } },
      window.location.origin,
    );
  });

  it('shift-click on the background stays the plain deselect (no additive meaning)', () => {
    pointer('pointerdown', 320, 15, { shiftKey: true });
    pointer('pointerup', 320, 15, { shiftKey: true });
    pointer('click', 320, 15, { shiftKey: true });

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: null } },
      window.location.origin,
    );
  });

  it('background drag draws the solid rubber band + candidate highlights and posts MARQUEE', async () => {
    pointer('pointerdown', 320, 15); // background: deepest hit null
    pointer('pointermove', 100, 45); // past the threshold: marquee starts
    await settle();

    const layer = marqueeLayer()!;
    const band = layer.querySelector('[data-composerx-marquee="band"]') as HTMLElement;
    expect(band).toBeTruthy();
    // SOLID 1px accent border + ~8% accent wash (dashed stays reserved for
    // drop indicators).
    expect(band.style.borderStyle).toBe('solid');
    expect(band.style.borderWidth).toBe('1px');
    expect(band.style.backgroundColor).toContain('color-mix');
    expect(band.style.backgroundColor).toContain('8%');
    // Normalized rect between (320,15) and (100,45).
    expect(band.style.left).toBe('100px');
    expect(band.style.top).toBe('15px');
    expect(band.style.width).toBe('220px');
    expect(band.style.height).toBe('30px');
    // Live candidate highlight: only text-1 intersects; light solid outline.
    const highlights = layer.querySelectorAll('[data-composerx-marquee="candidate"]');
    expect(highlights).toHaveLength(1);
    expect((highlights[0] as HTMLElement).style.borderStyle).toBe('solid');
    expect((highlights[0] as HTMLElement).style.borderWidth).toBe('1.5px');

    pointer('pointerup', 100, 45);
    pointer('click', 100, 45);

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MARQUEE, payload: { ids: ['text-1'] } },
      window.location.origin,
    );
    const types = typesOf(postSpy);
    expect(types).not.toContain(COMPOSERX_SELECT); // the deselect click is suppressed
    expect(types).not.toContain(COMPOSERX_MOVE_START);
    // All marquee visuals clear on pointerup.
    expect(marqueeLayer()!.childElementCount).toBe(0);
  });

  it('a marquee touching nothing posts MARQUEE {ids: []}', () => {
    pointer('pointerdown', 320, 15);
    pointer('pointermove', 400, 100);
    pointer('pointerup', 400, 100);
    pointer('click', 400, 100);

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MARQUEE, payload: { ids: [] } },
      window.location.origin,
    );
    expect(typesOf(postSpy)).not.toContain(COMPOSERX_SELECT);
  });

  it('a sub-threshold background click still posts SELECT {id: null}', () => {
    pointer('pointerdown', 320, 15);
    pointer('pointermove', 322, 17); // under the threshold
    pointer('pointerup', 322, 17);
    pointer('click', 322, 17);

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: null } },
      window.location.origin,
    );
    expect(typesOf(postSpy)).not.toContain(COMPOSERX_MARQUEE);
  });

  it('Escape aborts the marquee silently: visuals cleared, NO message', async () => {
    pointer('pointerdown', 320, 15);
    pointer('pointermove', 100, 45);
    await settle();
    expect(marqueeLayer()!.childElementCount).toBeGreaterThan(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(marqueeLayer()!.childElementCount).toBe(0);
    pointer('pointerup', 100, 45);
    pointer('click', 100, 45);
    const types = typesOf(postSpy);
    expect(types).not.toContain(COMPOSERX_MARQUEE);
    expect(types).not.toContain(COMPOSERX_SELECT); // trailing click stays suppressed
  });

  it('pointercancel aborts the marquee silently too', async () => {
    pointer('pointerdown', 320, 15);
    pointer('pointermove', 100, 45);
    await settle();

    pointer('pointercancel', 100, 45);

    expect(marqueeLayer()!.childElementCount).toBe(0);
    pointer('pointerup', 100, 45);
    const types = typesOf(postSpy);
    expect(types).not.toContain(COMPOSERX_MARQUEE);
    expect(types).not.toContain(COMPOSERX_MOVE_CANCEL);
  });
});

describe('ComposerX sidecar v4: multi-outline SET_SELECTION (contract 4f)', () => {
  let originalParent: Window;

  beforeEach(() => {
    originalParent = window.parent;
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
    initComposerxSidecar();
    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'edit' } });
  });

  afterEach(() => {
    destroyComposerxSidecar();
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    document.body.replaceChildren();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: originalParent,
    });
    vi.restoreAllMocks();
  });

  it('draws the primary at 2px and every other id at 1.5px / 70% accent, primary first', () => {
    buildSurface();
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'button-1', ids: ['button-1', 'text-1'] },
    });

    const boxes = selectionBoxes();
    expect(boxes).toHaveLength(2); // the primary is not drawn twice
    const [primary, secondary] = boxes as [HTMLElement, HTMLElement];

    expect(primary.getAttribute('data-composerx-outline')).toBe('selection');
    expect(primary.style.borderStyle).toBe('solid');
    expect(primary.style.borderWidth).toBe('2px');
    // button-1 rect (10,60 100x40) inflated by 3 (1px offset + 2px border).
    expect(primary.style.left).toBe('7px');
    expect(primary.style.top).toBe('57px');
    expect(primary.style.width).toBe('106px');
    expect(primary.style.height).toBe('46px');

    expect(secondary.getAttribute('data-composerx-outline')).toBe('selection-secondary');
    expect(secondary.style.borderStyle).toBe('solid');
    expect(secondary.style.borderWidth).toBe('1.5px');
    expect(secondary.style.borderColor).toContain('70%');
    // text-1 rect (10,10 280x40) inflated by 2.5 (1px offset + 1.5px border).
    expect(secondary.style.left).toBe('7.5px');
    expect(secondary.style.top).toBe('7.5px');
    expect(secondary.style.width).toBe('285px');
    expect(secondary.style.height).toBe('45px');
  });

  it('re-anchors every outline after RENDER_A2UI and drops vanished ids individually', async () => {
    const { text, textWrap } = buildSurface();
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'button-1', ids: ['button-1', 'text-1'] },
    });
    expect(selectionBoxes()).toHaveLength(2);

    // The secondary component moved in a re-render: re-measure by id.
    stubRect(text, { x: 30, y: 200, width: 120, height: 20 });
    postFromHost({ type: 'RENDER_A2UI', payload: RENDER_PAYLOAD });
    await tick();
    await tick();
    const secondary = selectionBoxes().find(
      (box) => box.getAttribute('data-composerx-outline') === 'selection-secondary',
    )!;
    expect(secondary.style.left).toBe('27.5px');
    expect(secondary.style.top).toBe('197.5px');

    // text-1 no longer renders: its outline is dropped, the primary stays.
    textWrap.remove();
    postFromHost({ type: 'RENDER_A2UI', payload: RENDER_PAYLOAD });
    await tick();
    await tick();
    const boxes = selectionBoxes();
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.getAttribute('data-composerx-outline')).toBe('selection');
  });

  it('a payload without ids behaves exactly like v3 (single primary outline)', () => {
    buildSurface();
    postFromHost({ type: COMPOSERX_SET_SELECTION, payload: { id: 'button-1' } });

    const boxes = selectionBoxes();
    expect(boxes).toHaveLength(1);
    expect(boxes[0]!.getAttribute('data-composerx-outline')).toBe('selection');
    expect(boxes[0]!.style.borderWidth).toBe('2px');
  });

  it('clears everything on {id: null, ids: []} and tolerates junk ids entries', () => {
    buildSurface();
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'button-1', ids: ['button-1', 'text-1'] },
    });
    expect(selectionBoxes()).toHaveLength(2);

    postFromHost({ type: COMPOSERX_SET_SELECTION, payload: { id: null, ids: [] } });
    expect(selectionBoxes()).toHaveLength(0);

    // Non-string entries and unknown ids are ignored; known ones still draw.
    postFromHost({
      type: COMPOSERX_SET_SELECTION,
      payload: { id: 'button-1', ids: ['button-1', 42, null, 'no-such-id', 'text-1'] },
    });
    expect(selectionBoxes()).toHaveLength(2);
  });
});
