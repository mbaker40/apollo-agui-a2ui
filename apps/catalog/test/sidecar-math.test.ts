import { describe, expect, it } from 'vitest';
import {
  applyRenderItems,
  createStore,
  findRootId,
  mainAxis,
  resolveDropTarget,
  type Rect,
  type SurfaceStore,
} from '../src/sidecar-math';

/**
 * Synthetic layout, all rects in CSS px:
 *
 *   root Column (0,0 300x300)
 *     text-1  (10, 10, 280x40)
 *     row-1   (10, 60, 280x100)  Row
 *       text-2 (20, 70, 80x80)
 *       text-3 (120, 70, 80x80)
 *     card-1  (10, 170, 280x80)  Card (child: text-4)
 *       text-4 (20, 180, 260x60)
 */
const COMPONENTS = [
  { id: 'root', component: 'Column', children: ['text-1', 'row-1', 'card-1'] },
  { id: 'text-1', component: 'Text', text: 'a' },
  { id: 'row-1', component: 'Row', children: ['text-2', 'text-3'] },
  { id: 'text-2', component: 'Text', text: 'b' },
  { id: 'text-3', component: 'Text', text: 'c' },
  { id: 'card-1', component: 'Card', child: 'text-4' },
  { id: 'text-4', component: 'Text', text: 'd' },
];

const RECTS: Record<string, Rect> = {
  root: { x: 0, y: 0, width: 300, height: 300 },
  'text-1': { x: 10, y: 10, width: 280, height: 40 },
  'row-1': { x: 10, y: 60, width: 280, height: 100 },
  'text-2': { x: 20, y: 70, width: 80, height: 80 },
  'text-3': { x: 120, y: 70, width: 80, height: 80 },
  'card-1': { x: 10, y: 170, width: 280, height: 80 },
  'text-4': { x: 20, y: 180, width: 260, height: 60 },
};

const VIEWPORT: Rect = { x: 0, y: 0, width: 300, height: 300 };

function makeStore(components: unknown[] = COMPONENTS): SurfaceStore {
  const store = createStore();
  applyRenderItems(store, [
    { version: 'v0.9', createSurface: { surfaceId: 'composer-canvas', catalogId: 'urn:test' } },
    { version: 'v0.9', updateComponents: { surfaceId: 'composer-canvas', components } },
  ]);
  return store;
}

function resolve(x: number, y: number, hitId: string | null, store = makeStore()) {
  return resolveDropTarget({
    x,
    y,
    hitId,
    store,
    getRect: (id) => RECTS[id] ?? null,
    viewport: VIEWPORT,
  });
}

describe('applyRenderItems', () => {
  it('captures updateComponents and resets on createSurface', () => {
    const store = makeStore();
    expect(store.surfaceId).toBe('composer-canvas');
    expect(store.components.size).toBe(7);

    applyRenderItems(store, [
      { version: 'v0.9', createSurface: { surfaceId: 'composer-canvas', catalogId: 'urn:test' } },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'composer-canvas',
          components: [{ id: 'root', component: 'Column', children: [] }],
        },
      },
    ]);
    expect(store.components.size).toBe(1);
  });

  it('upserts by id and ignores foreign surfaces', () => {
    const store = makeStore();
    applyRenderItems(store, [
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'other-surface',
          components: [{ id: 'alien', component: 'Text' }],
        },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'composer-canvas',
          components: [{ id: 'text-1', text: 'updated' }],
        },
      },
    ]);
    expect(store.components.has('alien')).toBe(false);
    expect(store.components.get('text-1')).toMatchObject({ component: 'Text', text: 'updated' });
  });

  it('finds the root and container axes', () => {
    const store = makeStore();
    expect(findRootId(store)).toBe('root');
    expect(mainAxis(store.components.get('root')!)).toBe('y');
    expect(mainAxis(store.components.get('row-1')!)).toBe('x');
    expect(mainAxis({ id: 'l', component: 'List', direction: 'horizontal' })).toBe('x');
    expect(mainAxis({ id: 'l', component: 'List' })).toBe('y');
  });
});

describe('resolveDropTarget', () => {
  it('returns all-null with no components at all', () => {
    const target = resolveDropTarget({
      x: 50,
      y: 50,
      hitId: null,
      store: createStore(),
      getRect: () => null,
      viewport: VIEWPORT,
    });
    expect(target).toEqual({
      targetId: null,
      containerId: null,
      index: null,
      slot: null,
      rect: null,
    });
  });

  it('maps empty-canvas hover (no hit) to the root container', () => {
    const target = resolve(150, 290, null);
    expect(target.targetId).toBeNull();
    expect(target.containerId).toBe('root');
    expect(target.slot).toBe('into');
    expect(target.index).toBe(3); // below every child -> append at the end
    expect(target.rect).not.toBeNull();
  });

  it('maps container-interior hover to into with a between-children index', () => {
    // Pointer in the gap between text-1 (mid y=30) and row-1 (mid y=110).
    const target = resolve(150, 55, 'root');
    expect(target).toMatchObject({
      targetId: 'root',
      containerId: 'root',
      slot: 'into',
      index: 1,
    });
    // Caret between text-1's bottom (50) and row-1's top (60).
    expect(target.rect?.y).toBeGreaterThan(48);
    expect(target.rect?.y).toBeLessThan(62);
    expect(target.rect?.width).toBe(300);
  });

  it('maps into an empty container with an interior rect', () => {
    const store = makeStore([{ id: 'root', component: 'Column', children: [] }]);
    const target = resolveDropTarget({
      x: 20,
      y: 20,
      hitId: 'root',
      store,
      getRect: (id) => (id === 'root' ? RECTS['root']! : null),
      viewport: VIEWPORT,
    });
    expect(target).toMatchObject({ containerId: 'root', slot: 'into', index: 0 });
    expect(target.rect).toMatchObject({ x: 4, y: 4, width: 292, height: 292 });
  });

  it('maps leaf hover to before along the parent Column main axis (y)', () => {
    // text-1 mid y = 30; pointer above it.
    const target = resolve(150, 20, 'text-1');
    expect(target).toMatchObject({
      targetId: 'text-1',
      containerId: 'root',
      slot: 'before',
      index: 0,
    });
    // Horizontal caret at text-1's top edge (10), centered on it.
    expect(target.rect?.y).toBeGreaterThanOrEqual(7);
    expect(target.rect?.y).toBeLessThanOrEqual(11);
    expect(target.rect?.height).toBeLessThanOrEqual(6);
  });

  it('maps leaf hover to after along the parent Row main axis (x)', () => {
    // text-2 mid x = 60; pointer to the right of it.
    const target = resolve(90, 100, 'text-2');
    expect(target).toMatchObject({
      targetId: 'text-2',
      containerId: 'row-1',
      slot: 'after',
      index: 1,
    });
    // Vertical caret at text-2's right edge (100), centered on it.
    expect(target.rect?.x).toBeGreaterThanOrEqual(97);
    expect(target.rect?.x).toBeLessThanOrEqual(101);
    expect(target.rect?.width).toBeLessThanOrEqual(6);
  });

  it('resolves a leaf linked through a child slot to its children-array ancestor', () => {
    // text-4 lives in card-1 via `child`; card-1 sits in root's children.
    // Pointer below card-1's midpoint (y=210) -> after card-1 in root.
    const target = resolve(150, 240, 'text-4');
    expect(target).toMatchObject({
      targetId: 'text-4',
      containerId: 'root',
      slot: 'after',
      index: 3,
    });
  });

  it('treats Card as a leaf (single `child` slot, not a children container)', () => {
    // Pointer above card-1's midpoint (y=210) -> before card-1 in root.
    const target = resolve(15, 175, 'card-1');
    expect(target).toMatchObject({
      targetId: 'card-1',
      containerId: 'root',
      slot: 'before',
      index: 2,
    });
  });
});
