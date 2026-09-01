/**
 * Sidecar v3 canvas move (contract section 4e): the press-and-drag lift on
 * the edit veil. Same jsdom window.parent stubbing pattern as
 * sidecar-v2.test.ts — hand-built `[data-a2ui-id]` DOM, stubbed rects, and a
 * coordinate-aware document.elementsFromPoint stub. jsdom has no PointerEvent
 * constructor, so pointer events are dispatched as MouseEvents exactly like
 * the existing hover tests (the sidecar never requires pointerId).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSERX_MOVE_CANCEL,
  COMPOSERX_MOVE_DROP,
  COMPOSERX_MOVE_START,
  COMPOSERX_SELECT,
  COMPOSERX_SET_MODE,
  DROP_INDICATOR_LAYER_ID,
  EDIT_VEIL_ID,
  MOVE_LAYER_ID,
  MOVE_THRESHOLD_PX,
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
  return { main, rootBox, text, button, label };
}

function veilElement(): HTMLElement | null {
  return document.getElementById(EDIT_VEIL_ID);
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

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

describe('ComposerX sidecar v3: canvas move gesture (contract 4e)', () => {
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
    delete (document as { elementsFromPoint?: unknown }).elementsFromPoint;
    document.body.replaceChildren();
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: originalParent,
    });
    vi.restoreAllMocks();
  });

  it('sub-threshold pointerup stays a click: SELECT only, no MOVE messages', () => {
    pointer('pointerdown', 30, 80); // on the button label
    pointer('pointermove', 32, 82); // ~2.8px, under the threshold
    pointer('pointerup', 32, 82);
    pointer('click', 32, 82);

    const types = typesOf(postSpy);
    expect(types).not.toContain(COMPOSERX_MOVE_START);
    expect(types).not.toContain(COMPOSERX_MOVE_DROP);
    expect(types).not.toContain(COMPOSERX_MOVE_CANCEL);
    // The click still selects the DEEPEST hit (contract 4c, unchanged).
    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: 'button-label' } },
      window.location.origin,
    );
  });

  it('threshold drag lifts the anchor: MOVE_START then MOVE_DROP, and NO SELECT', async () => {
    pointer('pointerdown', 30, 80); // pressing the label lifts button-1
    pointer('pointermove', 150, 20); // far past the ~5px threshold

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MOVE_START, payload: { id: 'button-1' } },
      window.location.origin,
    );

    // Ghost + dimmed origin render in the move layer; §4b indicator follows.
    await settle();
    const moveLayer = document.getElementById(MOVE_LAYER_ID)!;
    const ghost = moveLayer.querySelector('[data-composerx-move="ghost"]') as HTMLElement;
    expect(ghost).not.toBeNull();
    expect(ghost.style.borderStyle).toBe('solid');
    expect(ghost.querySelector('[data-composerx-move="ghost-label"]')?.textContent).toBe('Button');
    const origin = moveLayer.querySelector('[data-composerx-move="origin"]') as HTMLElement;
    expect(origin).not.toBeNull();
    expect(origin.style.borderStyle).toBe('dashed');
    // Origin box sits at button-1's measured rect.
    expect(origin.style.left).toBe('10px');
    expect(origin.style.top).toBe('60px');
    expect(document.getElementById(DROP_INDICATOR_LAYER_ID)!.childElementCount).toBeGreaterThan(0);

    pointer('pointerup', 150, 20); // over text-1's upper half
    pointer('click', 150, 20);

    // (150,20) hits text-1 above its midpoint -> before text-1 in root; with
    // button-1 excluded the filtered children are [text-1] -> index 0.
    expect(postSpy).toHaveBeenCalledWith(
      {
        type: COMPOSERX_MOVE_DROP,
        payload: { id: 'button-1', containerId: 'root', index: 0, slot: 'before' },
      },
      window.location.origin,
    );
    const types = typesOf(postSpy);
    expect(types.filter((type) => type === COMPOSERX_MOVE_START)).toHaveLength(1);
    expect(types).not.toContain(COMPOSERX_SELECT); // suppressed for this gesture
    expect(types).not.toContain(COMPOSERX_MOVE_CANCEL);

    // Every move visual clears on drop.
    expect(document.getElementById(MOVE_LAYER_ID)!.childElementCount).toBe(0);
    expect(document.getElementById(DROP_INDICATOR_LAYER_ID)!.childElementCount).toBe(0);
  });

  it("dropping over the moved node's own area targets the parent context with an after-removal index", () => {
    pointer('pointerdown', 30, 80);
    pointer('pointermove', 60, 85); // 30px right: threshold crossed
    pointer('pointerup', 60, 85); // still over button-1's own rect
    pointer('click', 60, 85);

    // Hit inside the moved subtree -> as if absent -> 'into' root; filtered
    // children [text-1], pointer below text-1's midpoint -> index 1 (which is
    // exactly button-1's own position after removal).
    expect(postSpy).toHaveBeenCalledWith(
      {
        type: COMPOSERX_MOVE_DROP,
        payload: { id: 'button-1', containerId: 'root', index: 1, slot: 'into' },
      },
      window.location.origin,
    );
    expect(typesOf(postSpy)).not.toContain(COMPOSERX_SELECT);
  });

  it('Escape mid-drag posts MOVE_CANCEL, clears visuals, and still suppresses the SELECT', async () => {
    pointer('pointerdown', 30, 80);
    pointer('pointermove', 150, 20);
    await settle();
    expect(document.getElementById(MOVE_LAYER_ID)!.childElementCount).toBeGreaterThan(0);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MOVE_CANCEL, payload: { id: 'button-1' } },
      window.location.origin,
    );
    expect(document.getElementById(MOVE_LAYER_ID)!.childElementCount).toBe(0);
    expect(document.getElementById(DROP_INDICATOR_LAYER_ID)!.childElementCount).toBe(0);

    // The pointer is still down; releasing it must not DROP, and the
    // gesture's trailing click must not SELECT.
    pointer('pointerup', 150, 20);
    pointer('click', 150, 20);
    const types = typesOf(postSpy);
    expect(types).not.toContain(COMPOSERX_MOVE_DROP);
    expect(types).not.toContain(COMPOSERX_SELECT);
    expect(types.filter((type) => type === COMPOSERX_MOVE_CANCEL)).toHaveLength(1);

    // Escape consumed the suppression: the NEXT click selects again.
    pointer('pointerdown', 30, 80);
    pointer('pointerup', 30, 80);
    pointer('click', 30, 80);
    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: 'button-label' } },
      window.location.origin,
    );
  });

  it('pointercancel mid-drag posts MOVE_CANCEL and clears visuals', async () => {
    pointer('pointerdown', 30, 80);
    pointer('pointermove', 150, 20);
    await settle();

    pointer('pointercancel', 150, 20);

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MOVE_CANCEL, payload: { id: 'button-1' } },
      window.location.origin,
    );
    expect(document.getElementById(MOVE_LAYER_ID)!.childElementCount).toBe(0);
    pointer('pointerup', 150, 20);
    expect(typesOf(postSpy)).not.toContain(COMPOSERX_MOVE_DROP);
  });

  it('pressing the background or the root arms no move', () => {
    pointer('pointerdown', 250, 250); // root's own area: lift anchor is null
    pointer('pointermove', 100, 100);
    pointer('pointerup', 100, 100);

    const types = typesOf(postSpy);
    expect(types).not.toContain(COMPOSERX_MOVE_START);
    expect(types).not.toContain(COMPOSERX_MOVE_DROP);
    expect(types).not.toContain(COMPOSERX_MOVE_CANCEL);
  });

  it('preview mode has no veil and therefore no gesture', () => {
    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'preview' } });
    expect(veilElement()).toBeNull();

    pointer('pointerdown', 30, 80, document.body);
    pointer('pointermove', 150, 20, document.body);
    pointer('pointerup', 150, 20, document.body);

    const types = typesOf(postSpy);
    expect(types).not.toContain(COMPOSERX_MOVE_START);
    expect(types).not.toContain(COMPOSERX_MOVE_DROP);
    expect(types).not.toContain(COMPOSERX_MOVE_CANCEL);
  });

  it('switching to preview mid-drag cancels the move', () => {
    pointer('pointerdown', 30, 80);
    pointer('pointermove', 150, 20);
    expect(typesOf(postSpy)).toContain(COMPOSERX_MOVE_START);

    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'preview' } });

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MOVE_CANCEL, payload: { id: 'button-1' } },
      window.location.origin,
    );
    expect(document.getElementById(MOVE_LAYER_ID)!.childElementCount).toBe(0);
  });

  it('a RENDER_A2UI landing mid-drag cancels the move (stale mirror)', () => {
    pointer('pointerdown', 30, 80);
    pointer('pointermove', 150, 20);
    expect(typesOf(postSpy)).toContain(COMPOSERX_MOVE_START);

    postFromHost({ type: 'RENDER_A2UI', payload: RENDER_PAYLOAD });

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_MOVE_CANCEL, payload: { id: 'button-1' } },
      window.location.origin,
    );
    pointer('pointerup', 150, 20);
    expect(typesOf(postSpy)).not.toContain(COMPOSERX_MOVE_DROP);
  });

  it('exposes the ~5px threshold constant the contract names', () => {
    expect(MOVE_THRESHOLD_PX).toBe(5);
  });
});
