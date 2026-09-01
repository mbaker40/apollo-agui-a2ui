/**
 * Sidecar v2 behavior (contract sections 4b/4c): edit veil + modes,
 * click-to-select, selection outlines, and the dashed drop-indicator styling.
 * Uses the same jsdom window.parent stubbing pattern as app.test.tsx, but
 * drives the sidecar directly against hand-built `[data-a2ui-id]` DOM (no
 * React needed — the sidecar only sees the DOM and postMessage traffic).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  COMPOSERX_DND_END,
  COMPOSERX_DND_HOVER,
  COMPOSERX_SELECT,
  COMPOSERX_SET_MODE,
  COMPOSERX_SET_SELECTION,
  DROP_INDICATOR_LAYER_ID,
  EDIT_VEIL_ID,
  HOVER_LAYER_ID,
  SELECTION_LAYER_ID,
  destroyComposerxSidecar,
  initComposerxSidecar,
  renderDropIndicator,
} from '../src/sidecar';
import type { Rect } from '../src/sidecar-math';

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
      components: [{ id: 'root', component: 'Column', children: [] }],
    },
  },
];

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

/** root Column > (box div) > Button button-1 > Text button-label. */
function buildSurface() {
  const main = document.createElement('main');
  main.className = 'sandbox-shell';
  const rootWrap = wrapSpan('root', 'Column');
  const rootBox = document.createElement('div');
  const buttonWrap = wrapSpan('button-1', 'Button');
  const button = document.createElement('button');
  const labelWrap = wrapSpan('button-label', 'Text');
  const label = document.createElement('em');
  label.textContent = 'Go';
  labelWrap.appendChild(label);
  button.appendChild(labelWrap);
  buttonWrap.appendChild(button);
  rootBox.appendChild(buttonWrap);
  rootWrap.appendChild(rootBox);
  main.appendChild(rootWrap);
  document.body.appendChild(main);
  stubRect(rootBox, { x: 0, y: 0, width: 300, height: 300 });
  stubRect(button, { x: 20, y: 30, width: 100, height: 40 });
  stubRect(label, { x: 35, y: 42, width: 70, height: 16 });
  return { main, rootBox, buttonWrap, button, label };
}

function veilElement(): HTMLElement | null {
  return document.getElementById(EDIT_VEIL_ID);
}

function selectionBox(): HTMLElement | null {
  return (document.getElementById(SELECTION_LAYER_ID)?.firstElementChild ??
    null) as HTMLElement | null;
}

function postFromHost(data: unknown, origin = window.location.origin): void {
  window.dispatchEvent(new MessageEvent('message', { source: window.parent, origin, data }));
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('ComposerX sidecar v2: modes, selection, indicators', () => {
  let originalParent: Window;

  beforeEach(() => {
    originalParent = window.parent;
    Object.defineProperty(window, 'parent', {
      configurable: true,
      value: { postMessage: vi.fn() },
    });
    initComposerxSidecar();
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

  it('defaults to preview mode: no veil until a host sends SET_MODE edit', () => {
    // A host that never speaks COMPOSERX (the official hosted composer) must
    // get a fully interactive standard renderer.
    expect(veilElement()).toBeNull();
    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'edit' } });
    const veil = veilElement();
    expect(veil).not.toBeNull();
    expect(veil!.style.pointerEvents).toBe('auto');
    expect(veil!.style.position).toBe('fixed');
    expect(veil!.hasAttribute('data-composerx-layer')).toBe(true);
  });

  it('SET_MODE toggles the veil idempotently', () => {
    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'preview' } });
    expect(veilElement()).toBeNull();
    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'preview' } });
    expect(veilElement()).toBeNull();

    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'edit' } });
    expect(veilElement()).not.toBeNull();
    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'edit' } });
    expect(document.querySelectorAll(`#${EDIT_VEIL_ID}`)).toHaveLength(1);
  });

  it('ignores malformed SET_MODE payloads', () => {
    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'bogus' } });
    expect(veilElement()).not.toBeNull();
    postFromHost({ type: COMPOSERX_SET_MODE });
    expect(veilElement()).not.toBeNull();
  });

  it('ignores SET_MODE from untrusted origins', () => {
    postFromHost(
      { type: COMPOSERX_SET_MODE, payload: { mode: 'preview' } },
      'https://evil.example',
    );
    expect(veilElement()).not.toBeNull();
  });

  it('veil click posts COMPOSERX_SELECT with the deepest data-a2ui-id', () => {
    const { label } = buildSurface();
    const postSpy = vi.spyOn(window.parent, 'postMessage');
    const veil = veilElement()!;
    document.elementsFromPoint = () => [veil, label];

    veil.dispatchEvent(new MouseEvent('click', { clientX: 30, clientY: 40, bubbles: true }));

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: 'button-label' } },
      window.location.origin,
    );
  });

  it('background veil click posts COMPOSERX_SELECT with id null', () => {
    const { main } = buildSurface();
    const postSpy = vi.spyOn(window.parent, 'postMessage');
    const veil = veilElement()!;
    document.elementsFromPoint = () => [veil, main, document.body];

    veil.dispatchEvent(new MouseEvent('click', { clientX: 290, clientY: 290, bubbles: true }));

    expect(postSpy).toHaveBeenCalledWith(
      { type: COMPOSERX_SELECT, payload: { id: null } },
      window.location.origin,
    );
  });

  it('SET_SELECTION draws a solid 2px outline offset around the component rect', () => {
    buildSurface();
    postFromHost({ type: COMPOSERX_SET_SELECTION, payload: { id: 'button-1' } });

    const box = selectionBox();
    expect(box).not.toBeNull();
    expect(box!.style.borderStyle).toBe('solid');
    expect(box!.style.borderWidth).toBe('2px');
    // Button rect (20,30 100x40) inflated by 3px = 1px offset + 2px border.
    expect(box!.style.left).toBe('17px');
    expect(box!.style.top).toBe('27px');
    expect(box!.style.width).toBe('106px');
    expect(box!.style.height).toBe('46px');
    const layer = document.getElementById(SELECTION_LAYER_ID)!;
    expect(layer.style.pointerEvents).toBe('none');
  });

  it('SET_SELECTION null (or an unknown id) clears the outline', () => {
    buildSurface();
    postFromHost({ type: COMPOSERX_SET_SELECTION, payload: { id: 'button-1' } });
    expect(selectionBox()).not.toBeNull();

    postFromHost({ type: COMPOSERX_SET_SELECTION, payload: { id: null } });
    expect(selectionBox()).toBeNull();

    postFromHost({ type: COMPOSERX_SET_SELECTION, payload: { id: 'no-such-id' } });
    expect(selectionBox()).toBeNull();
  });

  it('re-anchors the outline after RENDER_A2UI and clears it when the id is gone', async () => {
    const { buttonWrap, button } = buildSurface();
    postFromHost({ type: COMPOSERX_SET_SELECTION, payload: { id: 'button-1' } });
    expect(selectionBox()!.style.left).toBe('17px');

    // The component moved in a re-render: re-measure by id after RENDER_A2UI.
    stubRect(button, { x: 120, y: 60, width: 100, height: 40 });
    postFromHost({ type: 'RENDER_A2UI', payload: RENDER_PAYLOAD });
    await tick();
    await tick();
    expect(selectionBox()!.style.left).toBe('117px');
    expect(selectionBox()!.style.top).toBe('57px');

    // The id no longer renders: outline removed.
    buttonWrap.remove();
    postFromHost({ type: 'RENDER_A2UI', payload: RENDER_PAYLOAD });
    await tick();
    await tick();
    expect(selectionBox()).toBeNull();
  });

  it('preview mode hides veil/hover/selection; edit mode restores the outline', () => {
    buildSurface();
    postFromHost({ type: COMPOSERX_SET_SELECTION, payload: { id: 'button-1' } });
    expect(selectionBox()).not.toBeNull();

    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'preview' } });
    expect(veilElement()).toBeNull();
    expect(selectionBox()).toBeNull();
    expect(document.getElementById(HOVER_LAYER_ID)?.childElementCount ?? 0).toBe(0);

    // Selection id is retained sidecar-side; edit mode redraws it.
    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'edit' } });
    expect(selectionBox()).not.toBeNull();
    expect(selectionBox()!.style.left).toBe('17px');
  });

  it('SET_SELECTION during preview mode is stored but not drawn', () => {
    buildSurface();
    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'preview' } });
    postFromHost({ type: COMPOSERX_SET_SELECTION, payload: { id: 'button-1' } });
    expect(selectionBox()).toBeNull();

    postFromHost({ type: COMPOSERX_SET_MODE, payload: { mode: 'edit' } });
    expect(selectionBox()).not.toBeNull();
  });

  it('pointer movement over the veil draws a rAF-throttled 1px hover outline', async () => {
    const { label } = buildSurface();
    const veil = veilElement()!;
    document.elementsFromPoint = () => [veil, label];

    veil.dispatchEvent(new MouseEvent('pointermove', { clientX: 30, clientY: 40, bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    const hoverBox = document.getElementById(HOVER_LAYER_ID)?.firstElementChild as HTMLElement;
    expect(hoverBox).toBeTruthy();
    expect(hoverBox.style.borderStyle).toBe('solid');
    expect(hoverBox.style.borderWidth).toBe('1px');

    veil.dispatchEvent(new MouseEvent('pointerleave', { bubbles: false }));
    expect(document.getElementById(HOVER_LAYER_ID)?.childElementCount).toBe(0);
  });

  it('DND_HOVER draws the dashed into indicator; DND_END clears it', () => {
    postFromHost({ type: 'RENDER_A2UI', payload: RENDER_PAYLOAD });
    postFromHost({ type: COMPOSERX_DND_HOVER, payload: { x: 24, y: 24 } });

    const layer = document.getElementById(DROP_INDICATOR_LAYER_ID)!;
    expect(layer.childElementCount).toBe(1);
    const into = layer.firstElementChild as HTMLElement;
    expect(into.getAttribute('data-composerx-indicator')).toBe('into');
    expect(into.style.borderStyle).toBe('dashed');
    expect(into.style.borderWidth).toBe('2px');
    expect(into.style.borderRadius).toBe('6px');
    expect(into.style.backgroundColor).toContain('color-mix');

    postFromHost({ type: COMPOSERX_DND_END });
    expect(layer.childElementCount).toBe(0);
  });
});

describe('renderDropIndicator styling (contract 4b)', () => {
  const CONTAINER_RECT: Rect = { x: 0, y: 0, width: 300, height: 300 };
  const getRect = (id: string) => (id === 'root' ? CONTAINER_RECT : null);

  function render(target: Parameters<typeof renderDropIndicator>[1]) {
    const layer = document.createElement('div');
    renderDropIndicator(layer, target, getRect);
    return layer;
  }

  it("'into' draws one dashed 2px outline (6px radius) with an accent wash at the container rect", () => {
    const layer = render({
      targetId: 'root',
      containerId: 'root',
      index: 0,
      slot: 'into',
      rect: { x: 4, y: 4, width: 292, height: 292 },
    });
    expect(layer.childElementCount).toBe(1);
    const into = layer.firstElementChild as HTMLElement;
    expect(into.getAttribute('data-composerx-indicator')).toBe('into');
    expect(into.style.borderStyle).toBe('dashed');
    expect(into.style.borderWidth).toBe('2px');
    expect(into.style.borderRadius).toBe('6px');
    expect(into.style.backgroundColor).toContain('color-mix');
    // Drawn around the container rect, not the caret rect.
    expect(into.style.left).toBe('0px');
    expect(into.style.width).toBe('300px');
  });

  it("'before' draws a dashed caret line with dot end-caps plus a faint dashed container outline", () => {
    const layer = render({
      targetId: 'text-1',
      containerId: 'root',
      index: 0,
      slot: 'before',
      rect: { x: 10, y: 8, width: 280, height: 4 },
    });
    expect(layer.childElementCount).toBe(2);

    const outline = layer.querySelector('[data-composerx-indicator="container"]') as HTMLElement;
    expect(outline).not.toBeNull();
    expect(outline.style.borderStyle).toBe('dashed');
    expect(outline.style.borderWidth).toBe('1px');

    const caret = layer.querySelector('[data-composerx-indicator="caret"]') as HTMLElement;
    expect(caret).not.toBeNull();
    const line = caret.querySelector('[data-composerx-indicator="caret-line"]') as HTMLElement;
    // Horizontal caret (width >= height): dashed top border is the line.
    expect(line.style.borderTopStyle).toBe('dashed');
    expect(line.style.borderTopWidth).toBe('2px');
    expect(caret.querySelectorAll('[data-composerx-indicator="caret-dot"]')).toHaveLength(2);
  });

  it("'after' with a vertical caret uses a dashed left border and skips the container outline when unmeasurable", () => {
    const layer = render({
      targetId: 'text-2',
      containerId: 'row-9',
      index: 1,
      slot: 'after',
      rect: { x: 98, y: 70, width: 4, height: 80 },
    });
    // row-9 has no rect: only the caret renders.
    expect(layer.childElementCount).toBe(1);
    const caret = layer.firstElementChild as HTMLElement;
    expect(caret.getAttribute('data-composerx-indicator')).toBe('caret');
    const line = caret.querySelector('[data-composerx-indicator="caret-line"]') as HTMLElement;
    expect(line.style.borderLeftStyle).toBe('dashed');
    expect(line.style.borderLeftWidth).toBe('2px');
  });

  it('no target draws nothing', () => {
    const layer = render({
      targetId: null,
      containerId: null,
      index: null,
      slot: null,
      rect: null,
    });
    expect(layer.childElementCount).toBe(0);
  });
});
