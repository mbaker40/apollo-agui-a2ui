/**
 * Pure logic for the COMPOSERX drag-and-drop sidecar (contract section 4):
 * mirrors the component tree from RENDER_A2UI traffic and resolves a hover
 * point + deepest-hit component id into a drop target
 * (`containerId`/`index`/`slot`/`rect`). DOM concerns live in sidecar.ts.
 */

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ComponentInstance {
  id: string;
  component: string;
  children?: unknown;
  child?: unknown;
  [key: string]: unknown;
}

export interface SurfaceStore {
  surfaceId: string | null;
  components: Map<string, ComponentInstance>;
}

export interface DropTarget {
  targetId: string | null;
  containerId: string | null;
  index: number | null;
  slot: 'before' | 'after' | 'into' | null;
  rect: Rect | null;
}

/**
 * Components that hold a spliceable `children` array — the only valid 'into'
 * targets. Per @a2ui/web_core@0.10.6 basic_components schemas, Card/Button
 * take a single required `child`, Modal takes `trigger`/`content`, and Tabs
 * takes `tabs: [{title, child}]`; hovering those resolves before/after within
 * their nearest children-array ancestor like any other leaf.
 */
export const CONTAINER_COMPONENTS: ReadonlySet<string> = new Set(['Row', 'Column', 'List']);

const INDICATOR_THICKNESS = 4;

export function createStore(): SurfaceStore {
  return { surfaceId: null, components: new Map() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Applies a RENDER_A2UI payload (read-only mirror of the bridge semantics:
 * createSurface resets, updateComponents upserts by id, deleteSurface clears).
 */
export function applyRenderItems(store: SurfaceStore, payload: unknown): SurfaceStore {
  if (!Array.isArray(payload)) return store;
  for (const item of payload) {
    if (!isRecord(item)) continue;
    const createSurface = item['createSurface'];
    if (isRecord(createSurface) && typeof createSurface['surfaceId'] === 'string') {
      store.surfaceId = createSurface['surfaceId'];
      store.components = new Map();
    }
    const deleteSurface = item['deleteSurface'];
    if (isRecord(deleteSurface) && deleteSurface['surfaceId'] === store.surfaceId) {
      store.surfaceId = null;
      store.components = new Map();
    }
    const updateComponents = item['updateComponents'];
    if (isRecord(updateComponents) && Array.isArray(updateComponents['components'])) {
      const surfaceId = updateComponents['surfaceId'];
      if (typeof surfaceId === 'string' && store.surfaceId === null) {
        store.surfaceId = surfaceId;
      }
      if (surfaceId !== store.surfaceId) continue;
      for (const comp of updateComponents['components'] as unknown[]) {
        if (!isRecord(comp) || typeof comp['id'] !== 'string') continue;
        const id = comp['id'];
        const existing = store.components.get(id);
        const type =
          typeof comp['component'] === 'string' ? comp['component'] : existing?.component;
        if (!type) continue;
        store.components.set(id, { ...comp, id, component: type });
      }
    }
  }
  return store;
}

/** Ids listed in the component's `children` array (splice targets). */
export function childrenOf(comp: ComponentInstance): string[] {
  if (!Array.isArray(comp.children)) return [];
  return comp.children.filter((c): c is string => typeof c === 'string');
}

/** Every child id reference (children, child, Modal trigger/content, Tabs tabs[].child). */
export function allChildIds(comp: ComponentInstance): string[] {
  const ids = [...childrenOf(comp)];
  for (const key of ['child', 'trigger', 'content'] as const) {
    const value = comp[key];
    if (typeof value === 'string') ids.push(value);
  }
  const tabs = comp['tabs'];
  if (Array.isArray(tabs)) {
    for (const tab of tabs) {
      if (isRecord(tab) && typeof tab['child'] === 'string') ids.push(tab['child']);
    }
  }
  return ids;
}

/** Maps every referenced child id to its parent id. */
export function buildParentIndex(store: SurfaceStore): Map<string, string> {
  const parents = new Map<string, string>();
  for (const comp of store.components.values()) {
    for (const childId of allChildIds(comp)) {
      parents.set(childId, comp.id);
    }
  }
  return parents;
}

/** The id the composer treats as the tree root ('root' per contract section 3). */
export function findRootId(store: SurfaceStore): string | null {
  if (store.components.size === 0) return null;
  if (store.components.has('root')) return 'root';
  const parents = buildParentIndex(store);
  for (const id of store.components.keys()) {
    if (!parents.has(id)) return id;
  }
  return null;
}

/** Main axis along which a container lays out its children. */
export function mainAxis(comp: ComponentInstance): 'x' | 'y' {
  if (comp.component === 'Row') return 'x';
  if (comp.component === 'List' && comp['direction'] === 'horizontal') return 'x';
  return 'y';
}

function mid(rect: Rect, axis: 'x' | 'y'): number {
  return axis === 'x' ? rect.x + rect.width / 2 : rect.y + rect.height / 2;
}

function insetRect(rect: Rect, amount: number): Rect {
  return {
    x: rect.x + amount,
    y: rect.y + amount,
    width: Math.max(0, rect.width - 2 * amount),
    height: Math.max(0, rect.height - 2 * amount),
  };
}

/** A caret line at `position` along `axis`, spanning `bounds` on the cross axis. */
function caretRect(bounds: Rect, axis: 'x' | 'y', position: number): Rect {
  if (axis === 'x') {
    return {
      x: position - INDICATOR_THICKNESS / 2,
      y: bounds.y,
      width: INDICATOR_THICKNESS,
      height: bounds.height,
    };
  }
  return {
    x: bounds.x,
    y: position - INDICATOR_THICKNESS / 2,
    width: bounds.width,
    height: INDICATOR_THICKNESS,
  };
}

export interface ResolveDropTargetArgs {
  x: number;
  y: number;
  /** Deepest component id under the pointer, or null when nothing was hit. */
  hitId: string | null;
  store: SurfaceStore;
  getRect: (id: string) => Rect | null;
  /** Viewport rect, used as the indicator fallback for the empty canvas. */
  viewport: Rect;
}

const NO_TARGET: DropTarget = {
  targetId: null,
  containerId: null,
  index: null,
  slot: null,
  rect: null,
};

/**
 * Contract section 4 semantics: container interior -> 'into' (index between
 * children along the main axis, or at the end); leaf -> 'before'/'after'
 * within its nearest ancestor holding a `children` array; empty canvas or
 * background -> 'into' the root container.
 */
export function resolveDropTarget(args: ResolveDropTargetArgs): DropTarget {
  const { x, y, hitId, store, getRect, viewport } = args;
  const rootId = findRootId(store);
  if (rootId === null) return NO_TARGET;

  const hit = hitId !== null ? store.components.get(hitId) : undefined;
  if (hitId === null || hit === undefined) {
    return rootTarget(null, rootId, store, getRect, viewport, x, y);
  }

  if (CONTAINER_COMPONENTS.has(hit.component)) {
    return intoTarget(hitId, hit, store, getRect, viewport, x, y);
  }

  // Leaf: find the nearest ancestor with a `children` array; the child of that
  // ancestor on the path down to the hit is the before/after anchor.
  const parents = buildParentIndex(store);
  let anchorId = hitId;
  let container: ComponentInstance | undefined;
  for (;;) {
    const parentId = parents.get(anchorId);
    if (parentId === undefined) break;
    const parent = store.components.get(parentId);
    if (parent === undefined) break;
    if (childrenOf(parent).includes(anchorId)) {
      container = parent;
      break;
    }
    anchorId = parentId;
  }
  if (container === undefined) {
    return rootTarget(hitId, rootId, store, getRect, viewport, x, y);
  }

  const axis = mainAxis(container);
  const children = childrenOf(container);
  const anchorIndex = Math.max(0, children.indexOf(anchorId));
  const anchorRect = getRect(anchorId) ?? getRect(container.id) ?? viewport;
  const pointer = axis === 'x' ? x : y;
  const before = pointer <= mid(anchorRect, axis);
  const edge =
    axis === 'x'
      ? before
        ? anchorRect.x
        : anchorRect.x + anchorRect.width
      : before
        ? anchorRect.y
        : anchorRect.y + anchorRect.height;
  return {
    targetId: hitId,
    containerId: container.id,
    index: before ? anchorIndex : anchorIndex + 1,
    slot: before ? 'before' : 'after',
    rect: caretRect(anchorRect, axis, edge),
  };
}

function rootTarget(
  targetId: string | null,
  rootId: string,
  store: SurfaceStore,
  getRect: (id: string) => Rect | null,
  viewport: Rect,
  x: number,
  y: number,
): DropTarget {
  const root = store.components.get(rootId);
  if (root === undefined) return NO_TARGET;
  const target = intoTarget(rootId, root, store, getRect, viewport, x, y);
  return { ...target, targetId };
}

function intoTarget(
  containerId: string,
  container: ComponentInstance,
  store: SurfaceStore,
  getRect: (id: string) => Rect | null,
  viewport: Rect,
  x: number,
  y: number,
): DropTarget {
  const axis = mainAxis(container);
  const pointer = axis === 'x' ? x : y;
  const children = childrenOf(container);
  const containerRect = getRect(containerId) ?? insetRect(viewport, 8);

  let index = 0;
  let previousEnd: number | null = null;
  let nextStart: number | null = null;
  for (const childId of children) {
    const childRect = getRect(childId);
    if (childRect === null || pointer > mid(childRect, axis)) {
      index += 1;
      if (childRect !== null) {
        previousEnd = axis === 'x' ? childRect.x + childRect.width : childRect.y + childRect.height;
      }
    } else if (nextStart === null) {
      nextStart = axis === 'x' ? childRect.x : childRect.y;
    }
  }

  let rect: Rect;
  if (children.length === 0) {
    rect = insetRect(containerRect, 4);
  } else {
    const position =
      previousEnd !== null && nextStart !== null
        ? (previousEnd + nextStart) / 2
        : (previousEnd ??
          nextStart ??
          (axis === 'x' ? containerRect.x + containerRect.width : containerRect.y));
    rect = caretRect(containerRect, axis, position);
  }

  return { targetId: containerId, containerId, index, slot: 'into', rect };
}
