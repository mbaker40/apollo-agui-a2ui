import { describe, expect, it } from 'vitest';
import {
  applyRenderItems,
  collectSubtreeIds,
  createStore,
  findRootId,
  mainAxis,
  resolveDropTarget,
  resolveLiftAnchor,
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

describe('resolveLiftAnchor (contract 4e)', () => {
  // COMPONENTS plus a Button (child slot) and a Tabs (tabs[].child slot).
  const LIFT_COMPONENTS = [
    {
      id: 'root',
      component: 'Column',
      children: ['text-1', 'row-1', 'card-1', 'button-1', 'tabs-1'],
    },
    { id: 'text-1', component: 'Text', text: 'a' },
    { id: 'row-1', component: 'Row', children: ['text-2', 'text-3'] },
    { id: 'text-2', component: 'Text', text: 'b' },
    { id: 'text-3', component: 'Text', text: 'c' },
    { id: 'card-1', component: 'Card', child: 'text-4' },
    { id: 'text-4', component: 'Text', text: 'd' },
    { id: 'button-1', component: 'Button', child: 'button-label' },
    { id: 'button-label', component: 'Text', text: 'Go' },
    { id: 'tabs-1', component: 'Tabs', tabs: [{ title: 't', child: 'tab-child' }] },
    { id: 'tab-child', component: 'Text', text: 'e' },
  ];
  const store = makeStore(LIFT_COMPONENTS);

  it("pressing a Button's inner label lifts the Button", () => {
    expect(resolveLiftAnchor(store, 'button-label')).toBe('button-1');
  });

  it("pressing a Card's slot-bound interior lifts the Card", () => {
    expect(resolveLiftAnchor(store, 'text-4')).toBe('card-1');
  });

  it("pressing a Tabs pane's child lifts the Tabs", () => {
    expect(resolveLiftAnchor(store, 'tab-child')).toBe('tabs-1');
  });

  it('a component sitting directly in a children array lifts itself', () => {
    expect(resolveLiftAnchor(store, 'text-2')).toBe('text-2');
    expect(resolveLiftAnchor(store, 'row-1')).toBe('row-1');
    expect(resolveLiftAnchor(store, 'card-1')).toBe('card-1');
  });

  it('the root, unknown ids, and null yield no lift anchor (no move starts)', () => {
    expect(resolveLiftAnchor(store, 'root')).toBeNull();
    expect(resolveLiftAnchor(store, 'no-such-id')).toBeNull();
    expect(resolveLiftAnchor(store, null)).toBeNull();
  });

  it('a slot occupant with no children-array ancestor yields null', () => {
    // Card as the root: its child has no children-array anywhere above.
    const slotOnly = makeStore([
      { id: 'root', component: 'Card', child: 'text-x' },
      { id: 'text-x', component: 'Text', text: 'x' },
    ]);
    expect(resolveLiftAnchor(slotOnly, 'text-x')).toBeNull();
  });

  it('collectSubtreeIds walks children arrays and slots', () => {
    expect(collectSubtreeIds(store, 'row-1')).toEqual(new Set(['row-1', 'text-2', 'text-3']));
    expect(collectSubtreeIds(store, 'card-1')).toEqual(new Set(['card-1', 'text-4']));
    expect(collectSubtreeIds(store, 'tabs-1')).toEqual(new Set(['tabs-1', 'tab-child']));
  });
});

describe('resolveDropTarget with excludeSubtree (contract 4e move)', () => {
  function resolveExcluding(x: number, y: number, hitId: string | null, excludeSubtree: string) {
    return resolveDropTarget({
      x,
      y,
      hitId,
      store: makeStore(),
      getRect: (id) => RECTS[id] ?? null,
      viewport: VIEWPORT,
      excludeSubtree,
    });
  }

  it("hovering the moved node's own area targets its parent context", () => {
    // Pointer inside row-1 (the moved component): as if row-1 were absent,
    // the hit falls to root; index 1 = row-1's own after-removal slot
    // (between text-1 mid 30 and card-1 mid 210).
    const target = resolveExcluding(150, 110, 'row-1', 'row-1');
    expect(target).toMatchObject({
      targetId: 'root',
      containerId: 'root',
      slot: 'into',
      index: 1,
    });
  });

  it('hits on descendants of the moved subtree also resolve to the parent context', () => {
    const target = resolveExcluding(90, 100, 'text-2', 'row-1');
    expect(target).toMatchObject({ containerId: 'root', slot: 'into', index: 1 });
  });

  it('a container being moved can never be its own target', () => {
    // Even a direct hit on the moved Row must not produce 'into row-1'.
    const target = resolveExcluding(150, 110, 'row-1', 'row-1');
    expect(target.containerId).not.toBe('row-1');
    // Nor can its interior gaps resolve inside the excluded subtree.
    expect(collectSubtreeIds(makeStore(), 'row-1').has(target.containerId as string)).toBe(false);
  });

  it('same-parent index is computed after removal: sibling AFTER the origin', () => {
    // card-1 sits at original index 2; with row-1 (index 1) removed the
    // filtered children are [text-1, card-1] and card-1's index is 1.
    const before = resolveExcluding(15, 175, 'card-1', 'row-1'); // above mid 210
    expect(before).toMatchObject({ containerId: 'root', slot: 'before', index: 1 });

    const after = resolveExcluding(15, 240, 'card-1', 'row-1'); // below mid 210
    expect(after).toMatchObject({ containerId: 'root', slot: 'after', index: 2 });
  });

  it('same-parent index is computed after removal: sibling BEFORE the origin', () => {
    // text-1 (index 0) precedes the moved row-1: indices are unshifted.
    const before = resolveExcluding(150, 20, 'text-1', 'row-1'); // above mid 30
    expect(before).toMatchObject({ containerId: 'root', slot: 'before', index: 0 });

    const after = resolveExcluding(150, 45, 'text-1', 'row-1'); // below mid 30
    expect(after).toMatchObject({ containerId: 'root', slot: 'after', index: 1 });
  });

  it('background hover appends at the after-removal end of root', () => {
    // Without exclusion this is index 3 (below every child); with card-1
    // excluded the filtered children are [text-1, row-1] -> index 2.
    const target = resolveExcluding(150, 290, null, 'card-1');
    expect(target).toMatchObject({ containerId: 'root', slot: 'into', index: 2 });
  });

  it('resolution elsewhere is untouched by the exclusion', () => {
    // Hover inside row-1 while moving card-1: same result as the plain path.
    const target = resolveExcluding(90, 100, 'text-2', 'card-1');
    expect(target).toMatchObject({
      targetId: 'text-2',
      containerId: 'row-1',
      slot: 'after',
      index: 1,
    });
  });

  it('an unknown excludeSubtree id behaves exactly like no exclusion', () => {
    const excluded = resolveExcluding(150, 55, 'root', 'no-such-id');
    const plain = resolve(150, 55, 'root');
    expect(excluded).toEqual(plain);
  });
});
