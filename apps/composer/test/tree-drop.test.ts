import { describe, expect, it } from 'vitest';
import type { DocComponent, SurfaceDoc } from '../src/lib/surface-doc';
import {
  CATALOG_ID,
  ROOT_ID,
  SURFACE_ID,
  moveComponent,
  moveComponents,
} from '../src/lib/surface-doc';
import {
  dropTargetForPointer,
  groupMoveIndexFor,
  moveIndexFor,
  resolveTreeDrop,
  zoneForPointer,
} from '../src/lib/tree-drop';

function docWith(components: DocComponent[]): SurfaceDoc {
  return { surfaceId: SURFACE_ID, catalogId: CATALOG_ID, components, dataModel: {} };
}

/** root Column → [card(Card→body Column→[inner]), a, b, c] — mixed shapes. */
function treeDoc(): SurfaceDoc {
  return docWith([
    { id: ROOT_ID, component: 'Column', children: ['card', 'a', 'b', 'c'] },
    { id: 'card', component: 'Card', child: 'body' },
    { id: 'body', component: 'Column', children: ['inner'] },
    { id: 'inner', component: 'Text', text: 'x' },
    { id: 'a', component: 'Text', text: 'a' },
    { id: 'b', component: 'Row', children: [] },
    { id: 'c', component: 'Text', text: 'c' },
  ]);
}

const rect = { top: 100, height: 30 };

describe('zoneForPointer', () => {
  it('splits container rows by thirds: before / into / after', () => {
    expect(zoneForPointer(rect, 105, true)).toBe('before'); // upper third
    expect(zoneForPointer(rect, 109, true)).toBe('before'); // just under 1/3
    expect(zoneForPointer(rect, 111, true)).toBe('into'); // middle third
    expect(zoneForPointer(rect, 115, true)).toBe('into');
    expect(zoneForPointer(rect, 119, true)).toBe('into');
    expect(zoneForPointer(rect, 121, true)).toBe('after'); // lower third
    expect(zoneForPointer(rect, 129, true)).toBe('after');
  });

  it('splits leaf rows by half: the middle behaves as before/after', () => {
    expect(zoneForPointer(rect, 105, false)).toBe('before');
    expect(zoneForPointer(rect, 114, false)).toBe('before'); // just under half
    expect(zoneForPointer(rect, 115, false)).toBe('after'); // half and below
    expect(zoneForPointer(rect, 129, false)).toBe('after');
  });

  it('treats degenerate rects (height 0) as the middle', () => {
    expect(zoneForPointer({ top: 0, height: 0 }, 0, true)).toBe('into');
    expect(zoneForPointer({ top: 0, height: 0 }, 0, false)).toBe('after');
  });
});

describe('resolveTreeDrop', () => {
  it("resolves before/after against the ROW'S PARENT's children at the row's position", () => {
    const doc = treeDoc();
    // 'a' sits at index 1 of root's children
    expect(resolveTreeDrop(doc, 'a', 'before')).toEqual({
      containerId: ROOT_ID,
      index: 1,
      slot: 'before',
    });
    expect(resolveTreeDrop(doc, 'a', 'after')).toEqual({
      containerId: ROOT_ID,
      index: 2,
      slot: 'after',
    });
    // 'inner' sits at index 0 of body's children
    expect(resolveTreeDrop(doc, 'inner', 'before')).toEqual({
      containerId: 'body',
      index: 0,
      slot: 'before',
    });
    expect(resolveTreeDrop(doc, 'inner', 'after')).toEqual({
      containerId: 'body',
      index: 1,
      slot: 'after',
    });
  });

  it('resolves into onto container rows at the end of their children', () => {
    const doc = treeDoc();
    expect(resolveTreeDrop(doc, ROOT_ID, 'into')).toEqual({
      containerId: ROOT_ID,
      index: 4,
      slot: 'into',
    });
    expect(resolveTreeDrop(doc, 'b', 'into')).toEqual({ containerId: 'b', index: 0, slot: 'into' });
    // a container with no children property yet → end = 0
    const bare = docWith([
      { id: ROOT_ID, component: 'Column', children: ['r'] },
      { id: 'r', component: 'Row' },
    ]);
    expect(resolveTreeDrop(bare, 'r', 'into')).toEqual({
      containerId: 'r',
      index: 0,
      slot: 'into',
    });
  });

  it('returns null for into on non-container rows', () => {
    const doc = treeDoc();
    expect(resolveTreeDrop(doc, 'a', 'into')).toBeNull();
    expect(resolveTreeDrop(doc, 'card', 'into')).toBeNull(); // Card is single-slot
    expect(resolveTreeDrop(doc, 'missing', 'into')).toBeNull();
  });

  it('returns null for before/after on rows without a children-array parent', () => {
    const doc = treeDoc();
    expect(resolveTreeDrop(doc, ROOT_ID, 'before')).toBeNull(); // root has no parent
    expect(resolveTreeDrop(doc, ROOT_ID, 'after')).toBeNull();
    expect(resolveTreeDrop(doc, 'body', 'before')).toBeNull(); // Card child slot occupant
    expect(resolveTreeDrop(doc, 'body', 'after')).toBeNull();
  });

  it('ignores children arrays on components outside the container set', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: ['odd'] },
      { id: 'odd', component: 'Card', children: ['x'], child: 'x' },
      { id: 'x', component: 'Text', text: 'x' },
    ]);
    // 'x' is listed in a children array, but its holder is a Card — not a
    // legal splice container, so there is no before/after position.
    expect(resolveTreeDrop(doc, 'x', 'before')).toBeNull();
  });
});

describe('dropTargetForPointer', () => {
  it('combines zone + resolution using the doc (container vs leaf)', () => {
    const doc = treeDoc();
    // upper third of container row 'b' → before it in root
    expect(dropTargetForPointer(doc, 'b', rect, 102)).toEqual({
      zone: 'before',
      target: { containerId: ROOT_ID, index: 2, slot: 'before' },
    });
    // middle of container row 'b' → into it
    expect(dropTargetForPointer(doc, 'b', rect, 115)).toEqual({
      zone: 'into',
      target: { containerId: 'b', index: 0, slot: 'into' },
    });
    // middle of leaf row 'a' (lower half) → after it in root
    expect(dropTargetForPointer(doc, 'a', rect, 116)).toEqual({
      zone: 'after',
      target: { containerId: ROOT_ID, index: 2, slot: 'after' },
    });
    // middle of the root row → into root (before/after would be null)
    expect(dropTargetForPointer(doc, ROOT_ID, rect, 115)).toEqual({
      zone: 'into',
      target: { containerId: ROOT_ID, index: 4, slot: 'into' },
    });
    // upper third of the root row → zone before, but no valid target
    expect(dropTargetForPointer(doc, ROOT_ID, rect, 101)).toEqual({
      zone: 'before',
      target: null,
    });
  });
});

describe('moveIndexFor (after-removal rule for move drops)', () => {
  it('decrements when the source sits in the same container ABOVE the target', () => {
    const doc = treeDoc(); // root children: [card, a, b, c]
    // moving 'a' (index 1) to after 'c' → tree resolves raw index 4;
    // after 'a' is removed the container is [card, b, c] → index 3
    const target = resolveTreeDrop(doc, 'c', 'after');
    expect(target).toEqual({ containerId: ROOT_ID, index: 4, slot: 'after' });
    expect(moveIndexFor(doc, 'a', target!)).toBe(3);
    // and the adjusted index gives the intended order end-to-end
    const moved = moveComponent(doc, 'a', ROOT_ID, 3);
    expect(moved.components.find((c) => c.id === ROOT_ID)!.children).toEqual([
      'card',
      'b',
      'c',
      'a',
    ]);
  });

  it('the canonical [a,b,c] example: a to after c → index 2 → [b,c,a]', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: ['a', 'b', 'c'] },
      { id: 'a', component: 'Text', text: 'a' },
      { id: 'b', component: 'Text', text: 'b' },
      { id: 'c', component: 'Text', text: 'c' },
    ]);
    const target = resolveTreeDrop(doc, 'c', 'after')!;
    expect(target.index).toBe(3);
    expect(moveIndexFor(doc, 'a', target)).toBe(2);
    expect(moveComponent(doc, 'a', ROOT_ID, 2).components[0]!.children).toEqual(['b', 'c', 'a']);
  });

  it('passes through when the source is below the target or in another container', () => {
    const doc = treeDoc();
    // 'c' (index 3) moving before 'a' (raw index 1): source below target
    const before = resolveTreeDrop(doc, 'a', 'before')!;
    expect(moveIndexFor(doc, 'c', before)).toBe(1);
    // cross-container: 'inner' (in body) dropping after 'a' in root
    const after = resolveTreeDrop(doc, 'a', 'after')!;
    expect(moveIndexFor(doc, 'inner', after)).toBe(2);
    // unknown-in-container source (defensive) passes through too
    expect(moveIndexFor(doc, 'ghost', after)).toBe(2);
  });

  it("adjusts 'into' the same container (raw end counts the source)", () => {
    const doc = treeDoc(); // root children: [card, a, b, c]
    const into = resolveTreeDrop(doc, ROOT_ID, 'into')!;
    expect(into.index).toBe(4);
    expect(moveIndexFor(doc, 'a', into)).toBe(3);
    const moved = moveComponent(doc, 'a', ROOT_ID, 3);
    expect(moved.components[0]!.children).toEqual(['card', 'b', 'c', 'a']);
  });
});

describe('groupMoveIndexFor (after-ALL-removals rule for group drops)', () => {
  /** root Column → [a, b, c, d] (four Text leaves). */
  function fourDoc(): SurfaceDoc {
    return docWith([
      { id: ROOT_ID, component: 'Column', children: ['a', 'b', 'c', 'd'] },
      { id: 'a', component: 'Text', text: 'a' },
      { id: 'b', component: 'Text', text: 'b' },
      { id: 'c', component: 'Text', text: 'c' },
      { id: 'd', component: 'Text', text: 'd' },
    ]);
  }

  it('subtracts EVERY moved id above the target in the same container, not just one', () => {
    const doc = fourDoc();
    // moving [a, b] to after 'd': the tree resolves raw index 4; BOTH moved
    // ids sit above it, so the after-removal container is [c, d] → index 2.
    const target = resolveTreeDrop(doc, 'd', 'after')!;
    expect(target.index).toBe(4);
    expect(groupMoveIndexFor(doc, ['a', 'b'], target)).toBe(2);
    // and the adjusted index gives the intended order end-to-end
    const moved = moveComponents(doc, ['a', 'b'], ROOT_ID, 2).doc;
    expect(moved.components[0]!.children).toEqual(['c', 'd', 'a', 'b']);
  });

  it('counts only the moved ids ABOVE the target position', () => {
    const doc = fourDoc();
    // moving [a, c] to before 'b' (raw index 1): only 'a' sits above → 0.
    const target = resolveTreeDrop(doc, 'b', 'before')!;
    expect(target.index).toBe(1);
    expect(groupMoveIndexFor(doc, ['a', 'c'], target)).toBe(0);
    const moved = moveComponents(doc, ['a', 'c'], ROOT_ID, 0).doc;
    expect(moved.components[0]!.children).toEqual(['a', 'c', 'b', 'd']);
  });

  it('passes through for cross-container groups and ids not in the target children', () => {
    const doc = treeDoc(); // root [card, a, b, c]; body [inner]
    const after = resolveTreeDrop(doc, 'a', 'after')!; // root, raw index 2
    expect(groupMoveIndexFor(doc, ['inner'], after)).toBe(2); // other container
    expect(groupMoveIndexFor(doc, ['ghost', 'body'], after)).toBe(2); // not listed anywhere here
    expect(groupMoveIndexFor(doc, [], after)).toBe(2); // defensive: empty group
  });

  it('counts duplicate occurrences (moveComponents splices them all out)', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: ['x', 'a', 'x', 'b'] },
      { id: 'x', component: 'Text', text: 'x' },
      { id: 'a', component: 'Text', text: 'a' },
      { id: 'b', component: 'Text', text: 'b' },
    ]);
    // before 'b' is raw index 3 — both 'x' occurrences above it vanish → 1.
    const target = resolveTreeDrop(doc, 'b', 'before')!;
    expect(target.index).toBe(3);
    expect(groupMoveIndexFor(doc, ['x'], target)).toBe(1);
    const moved = moveComponents(doc, ['x'], ROOT_ID, 1).doc;
    expect(moved.components[0]!.children).toEqual(['a', 'x', 'b']);
  });

  it('moveIndexFor is the single-id view of groupMoveIndexFor', () => {
    const doc = treeDoc();
    const target = resolveTreeDrop(doc, 'c', 'after')!;
    expect(moveIndexFor(doc, 'a', target)).toBe(groupMoveIndexFor(doc, ['a'], target));
    expect(moveIndexFor(doc, 'inner', target)).toBe(groupMoveIndexFor(doc, ['inner'], target));
  });
});
