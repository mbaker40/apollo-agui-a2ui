/**
 * The composer's surface document: pure functions only (contract §5).
 * Everything here is side-effect free and unit-tested; the store applies
 * these ops and re-sends RENDER_A2UI.
 */
import type { RenderA2uiItem } from 'a2ui-bridge/messages';
import type { ComponentUsage } from 'a2ui-bridge/render-config';

export const SURFACE_ID = 'composer-canvas';
export const CATALOG_ID = 'https://a2ui.org/specification/v0_9/basic_catalog.json';
export const ROOT_ID = 'root';

/**
 * Component types whose `children` arrays accept spliced-in snippets — the
 * only valid insert targets (contract §3). Per the renderer's zod schemas,
 * Card/Button take a single required `child`, Modal takes `trigger`/`content`,
 * and Tabs takes `tabs: [{title, child}]`; those slots are edited via
 * JSON/chat, never by drop.
 */
export const CONTAINER_COMPONENTS: ReadonlySet<string> = new Set(['Row', 'Column', 'List']);

/**
 * Keys the prop ops refuse to touch (contract §5): identity (`id`,
 * `component`) and the containment keys — those are edited structurally
 * (insert/remove/JSON), never through the inspector's prop widgets.
 */
export const GUARDED_PROP_KEYS: ReadonlySet<string> = new Set([
  'id',
  'component',
  'children',
  'child',
  'trigger',
  'content',
  'tabs',
]);

/** A component instance in the flat list. Unknown fields are preserved verbatim. */
export interface DocComponent {
  id: string;
  component: string;
  [key: string]: unknown;
}

export interface SurfaceDoc {
  surfaceId: string;
  catalogId: string;
  components: DocComponent[];
  dataModel: Record<string, unknown>;
}

export interface InsertTarget {
  containerId: string;
  index?: number | null;
}

export interface TreeNode {
  id: string;
  component: string;
  container: boolean;
  children: TreeNode[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function describeValue(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return `a ${typeof value}`;
}

export function emptyDoc(): SurfaceDoc {
  return {
    surfaceId: SURFACE_ID,
    catalogId: CATALOG_ID,
    components: [{ id: ROOT_ID, component: 'Column', children: [] }],
    dataModel: {},
  };
}

/** Serializes a doc to the canonical three-item RENDER_A2UI sequence (contract §3). */
export function toRenderMessages(doc: SurfaceDoc): RenderA2uiItem[] {
  return [
    {
      version: 'v0.9',
      createSurface: {
        surfaceId: doc.surfaceId,
        catalogId: doc.catalogId,
        sendDataModel: true,
      },
    },
    {
      version: 'v0.9',
      updateComponents: {
        surfaceId: doc.surfaceId,
        components: doc.components.map((c) => structuredClone(c)),
      },
    },
    {
      version: 'v0.9',
      updateDataModel: {
        surfaceId: doc.surfaceId,
        value: structuredClone(doc.dataModel),
      },
    },
  ];
}

function nestAtPath(path: string, value: unknown): Record<string, unknown> {
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length === 0) {
    if (!isRecord(value)) {
      throw new Error(
        `updateDataModel.value must be an object when no path is given, got ${describeValue(value)}`,
      );
    }
    return structuredClone(value);
  }
  const result: Record<string, unknown> = {};
  let cursor = result;
  segments.forEach((segment, i) => {
    if (i === segments.length - 1) {
      cursor[segment] = structuredClone(value);
    } else {
      const next: Record<string, unknown> = {};
      cursor[segment] = next;
      cursor = next;
    }
  });
  return result;
}

interface FoundDetails {
  surfaceId: string | undefined;
  details: Record<string, unknown>;
}

/**
 * Tolerant parse of a RENDER_A2UI item array back into a SurfaceDoc (contract §5).
 * - Accepts any array of items; the last createSurface / updateComponents /
 *   updateDataModel of the target surface wins (official example payloads with a
 *   different surfaceId paste straight in — the parsed doc is normalized back to
 *   the composer's own surfaceId).
 * - Unknown component fields are preserved.
 * - Missing pieces default sanely (bare root Column, empty data model).
 * - Throws descriptive errors on non-array or structurally malformed input.
 */
export function parseRenderMessages(items: unknown): SurfaceDoc {
  if (!Array.isArray(items)) {
    throw new Error(
      `RENDER_A2UI payload must be a JSON array of layout items, got ${describeValue(items)}`,
    );
  }

  const creates: FoundDetails[] = [];
  const updates: FoundDetails[] = [];
  const datas: FoundDetails[] = [];

  items.forEach((item, i) => {
    if (!isRecord(item)) {
      throw new Error(
        `item ${i}: expected an object with createSurface / updateComponents / updateDataModel, got ${describeValue(item)}`,
      );
    }
    const buckets = { createSurface: creates, updateComponents: updates, updateDataModel: datas };
    for (const key of Object.keys(buckets) as (keyof typeof buckets)[]) {
      const details = item[key];
      if (details === undefined) continue;
      if (!isRecord(details)) {
        throw new Error(`item ${i}: "${key}" must be an object, got ${describeValue(details)}`);
      }
      const surfaceId = typeof details.surfaceId === 'string' ? details.surfaceId : undefined;
      buckets[key].push({ surfaceId, details });
    }
  });

  const targetSurface =
    creates.at(-1)?.surfaceId ?? updates.at(-1)?.surfaceId ?? datas.at(-1)?.surfaceId ?? SURFACE_ID;
  const pick = (list: FoundDetails[]): FoundDetails | undefined => {
    const matching = list.filter((f) => f.surfaceId === undefined || f.surfaceId === targetSurface);
    return matching.at(-1);
  };

  const create = pick(creates);
  const update = pick(updates);
  const data = pick(datas);

  const catalogId =
    typeof create?.details.catalogId === 'string' ? create.details.catalogId : CATALOG_ID;

  let components: DocComponent[] = [];
  if (update !== undefined) {
    const raw = update.details.components;
    if (!Array.isArray(raw)) {
      throw new Error(`updateComponents.components must be an array, got ${describeValue(raw)}`);
    }
    components = raw.map((c, i) => {
      if (!isRecord(c)) {
        throw new Error(
          `updateComponents.components[${i}] must be an object, got ${describeValue(c)}`,
        );
      }
      if (typeof c.id !== 'string' || c.id.length === 0) {
        throw new Error(`updateComponents.components[${i}] is missing a string "id"`);
      }
      if (typeof c.component !== 'string' || c.component.length === 0) {
        throw new Error(`component "${c.id}" is missing a string "component" type`);
      }
      return structuredClone(c) as DocComponent;
    });
    if (components.length > 0 && !components.some((c) => c.id === ROOT_ID)) {
      throw new Error(`updateComponents has no component with id "${ROOT_ID}"`);
    }
  }
  if (components.length === 0) {
    components = emptyDoc().components;
  }

  let dataModel: Record<string, unknown> = {};
  if (data !== undefined) {
    if (!('value' in data.details)) {
      throw new Error('updateDataModel is missing "value" (the field is "value", not "contents")');
    }
    const path = typeof data.details.path === 'string' ? data.details.path : '';
    dataModel = nestAtPath(path, data.details.value);
  }

  return { surfaceId: SURFACE_ID, catalogId, components, dataModel };
}

/**
 * Collision-proof generation counter: scans every component id for the `-g<n>`
 * suffix and returns max + 1 (so remapped ids can never collide with earlier
 * generations, including ids that arrived via JSON paste).
 */
export function nextGen(doc: SurfaceDoc): number {
  let max = 0;
  for (const c of doc.components) {
    const m = /-g(\d+)$/.exec(c.id);
    if (m && m[1] !== undefined) {
      max = Math.max(max, Number(m[1]));
    }
  }
  return max + 1;
}

function collectReferences(value: unknown, known: ReadonlySet<string>, out: Set<string>): void {
  if (typeof value === 'string') {
    if (known.has(value)) out.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectReferences(v, known, out);
    return;
  }
  if (isRecord(value)) {
    for (const v of Object.values(value)) collectReferences(v, known, out);
  }
}

/**
 * Ids not reachable from root. An edge is any string prop (at any depth,
 * excluding `id`/`component` on the instance itself) that exactly matches a
 * component id — this covers `children` arrays, Button `child`, and indirect
 * references like Modal's `trigger`/`content`.
 */
function unreachableIds(components: DocComponent[]): string[] {
  const known = new Set(components.map((c) => c.id));
  const byId = new Map<string, DocComponent>();
  for (const c of components) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  const reachable = new Set<string>();
  const queue: string[] = [ROOT_ID];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || reachable.has(id)) continue;
    reachable.add(id);
    const comp = byId.get(id);
    if (!comp) continue;
    const refs = new Set<string>();
    for (const [key, value] of Object.entries(comp)) {
      if (key === 'id' || key === 'component') continue;
      collectReferences(value, known, refs);
    }
    for (const ref of refs) {
      if (!reachable.has(ref)) queue.push(ref);
    }
  }
  return components.map((c) => c.id).filter((id) => id !== ROOT_ID && !reachable.has(id));
}

/**
 * Inserts a glossary usage snippet into the doc (contract §5):
 * - every snippet id is remapped with a `-g<n>` suffix (`id`, `children`,
 *   `child`, and any string prop at any depth that exactly matches a snippet id);
 * - the remapped snippet root (`root` before remapping) is spliced into the
 *   target container's `children` at the target index (default: end of root);
 * - `usage.data` is shallow-merged into the doc's data model, existing keys win;
 * - throws (without changing anything) if the snippet would leave components
 *   unreachable from root.
 */
export function insertUsage(
  doc: SurfaceDoc,
  usage: ComponentUsage,
  target?: InsertTarget,
): SurfaceDoc {
  if (!Array.isArray(usage.usage) || usage.usage.length === 0) {
    throw new Error('usage snippet must be a non-empty array of components');
  }
  const snippet = usage.usage.map((c, i) => {
    if (!isRecord(c)) {
      throw new Error(`usage snippet [${i}] must be an object, got ${describeValue(c)}`);
    }
    if (typeof c.id !== 'string' || c.id.length === 0) {
      throw new Error(`usage snippet [${i}] is missing a string "id"`);
    }
    if (typeof c.component !== 'string' || c.component.length === 0) {
      throw new Error(`usage snippet "${c.id}" is missing a string "component" type`);
    }
    return c as DocComponent;
  });
  if (!snippet.some((c) => c.id === ROOT_ID)) {
    throw new Error(`usage snippet has no "${ROOT_ID}" component to splice into the layout`);
  }

  const containerId = target?.containerId ?? ROOT_ID;
  const container = doc.components.find((c) => c.id === containerId);
  if (!container) {
    throw new Error(`insert target "${containerId}" does not exist in the document`);
  }
  if (!CONTAINER_COMPONENTS.has(container.component)) {
    throw new Error(
      `insert target "${containerId}" is a ${container.component}, not a container ` +
        `(${[...CONTAINER_COMPONENTS].join(', ')})`,
    );
  }

  const gen = nextGen(doc);
  const snippetIds = new Set(snippet.map((c) => c.id));
  const remapDeep = (value: unknown): unknown => {
    if (typeof value === 'string') {
      return snippetIds.has(value) ? `${value}-g${gen}` : value;
    }
    if (Array.isArray(value)) return value.map(remapDeep);
    if (isRecord(value)) {
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, remapDeep(v)]));
    }
    return structuredClone(value);
  };
  const remapped: DocComponent[] = snippet.map((c) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(c)) {
      if (key === 'id') out[key] = `${c.id}-g${gen}`;
      else if (key === 'component') out[key] = value;
      else out[key] = remapDeep(value);
    }
    return out as DocComponent;
  });
  const newRootId = `${ROOT_ID}-g${gen}`;

  const existingChildren = container.children;
  let children: unknown[];
  if (existingChildren === undefined) {
    children = [];
  } else if (Array.isArray(existingChildren)) {
    children = [...existingChildren];
  } else {
    throw new Error(`container "${containerId}" has a non-array "children" property`);
  }
  const rawIndex = target?.index;
  const index =
    rawIndex === undefined || rawIndex === null
      ? children.length
      : Math.max(0, Math.min(children.length, Math.trunc(rawIndex)));
  children.splice(index, 0, newRootId);

  const components = doc.components.map((c) =>
    c.id === containerId ? ({ ...c, children } as DocComponent) : c,
  );
  components.push(...remapped);

  // Orphan invariant: newly inserted components must all be reachable from root.
  // Pre-existing unreachable components (a tolerated JSON paste) are left alone.
  const insertedIds = new Set(remapped.map((c) => c.id));
  const orphans = unreachableIds(components).filter((id) => insertedIds.has(id));
  if (orphans.length > 0) {
    throw new Error(
      `insert would orphan component(s): ${orphans.join(', ')} ` +
        `(every non-root component must be reachable from "${ROOT_ID}")`,
    );
  }

  const dataModel: Record<string, unknown> = {
    ...structuredClone(usage.data ?? {}),
    ...structuredClone(doc.dataModel),
  };

  return { surfaceId: doc.surfaceId, catalogId: doc.catalogId, components, dataModel };
}

/** Ids of components that can receive inserts, in flat-list order. */
export function listContainers(doc: SurfaceDoc): string[] {
  return doc.components.filter((c) => CONTAINER_COMPONENTS.has(c.component)).map((c) => c.id);
}

function findComponent(doc: SurfaceDoc, id: string): DocComponent {
  const found = doc.components.find((c) => c.id === id);
  if (!found) {
    throw new Error(`component "${id}" does not exist in the document`);
  }
  return found;
}

function guardPropKey(key: string): void {
  if (GUARDED_PROP_KEYS.has(key)) {
    throw new Error(
      `prop "${key}" cannot be edited directly (${[...GUARDED_PROP_KEYS].join(', ')} ` +
        'are structural — edit them via insert/remove/JSON)',
    );
  }
}

/**
 * Sets one prop on one component (contract §5). Pure: returns a new doc,
 * never mutates the input; the value (arbitrary JSON) is deep-cloned in.
 * Throws on unknown id and on guarded keys (`id`, `component`, containment).
 */
export function setComponentProp(
  doc: SurfaceDoc,
  id: string,
  key: string,
  value: unknown,
): SurfaceDoc {
  findComponent(doc, id);
  guardPropKey(key);
  const components = doc.components.map((c) =>
    c.id === id ? ({ ...c, [key]: structuredClone(value) } as DocComponent) : c,
  );
  return { ...doc, components };
}

/**
 * Removes one prop from one component (contract §5). Same guards as
 * setComponentProp; removing a key the component does not have is a no-op
 * (still returns a fresh doc object).
 */
export function removeComponentProp(doc: SurfaceDoc, id: string, key: string): SurfaceDoc {
  findComponent(doc, id);
  guardPropKey(key);
  const components = doc.components.map((c) => {
    if (c.id !== id || !(key in c)) return c;
    const next = { ...c } as Record<string, unknown>;
    delete next[key];
    return next as DocComponent;
  });
  return { ...doc, components };
}

/**
 * The id of a component that references `id` through a single slot
 * (`child`, `trigger`, `content`, or `tabs[].child`), or null. A single-slot
 * occupant cannot be removed on its own — deleting it would leave the parent
 * schema-invalid — so the inspector disables Delete when this is non-null.
 */
export function singleSlotParentOf(doc: SurfaceDoc, id: string): string | null {
  for (const c of doc.components) {
    if (c.id === id) continue;
    if (c.child === id || c.trigger === id || c.content === id) return c.id;
    if (Array.isArray(c.tabs) && c.tabs.some((t) => isRecord(t) && t.child === id)) {
      return c.id;
    }
  }
  return null;
}

/** Ids reachable from `startId` (inclusive) via reference edges — see unreachableIds. */
function reachableFrom(components: DocComponent[], startId: string): Set<string> {
  const known = new Set(components.map((c) => c.id));
  const byId = new Map<string, DocComponent>();
  for (const c of components) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  const reachable = new Set<string>();
  const queue: string[] = [startId];
  while (queue.length > 0) {
    const id = queue.pop();
    if (id === undefined || reachable.has(id)) continue;
    reachable.add(id);
    const comp = byId.get(id);
    if (!comp) continue;
    const refs = new Set<string>();
    for (const [key, value] of Object.entries(comp)) {
      if (key === 'id' || key === 'component') continue;
      collectReferences(value, known, refs);
    }
    for (const ref of refs) {
      if (!reachable.has(ref)) queue.push(ref);
    }
  }
  return reachable;
}

function reachableIds(components: DocComponent[]): Set<string> {
  return reachableFrom(components, ROOT_ID);
}

/**
 * Removes a component and its entire subtree (contract §5): the id is
 * spliced out of every `children` array that lists it, and every component
 * that was reachable from root only through it is dropped too (components
 * shared with the rest of the tree survive; pre-existing orphans from a
 * tolerated JSON paste are left alone). Throws for `root`, for unknown ids,
 * and for single-slot occupants (see singleSlotParentOf) — every doc this
 * op can produce stays schema-valid. Pure: never mutates the input.
 */
export function removeComponent(doc: SurfaceDoc, id: string): SurfaceDoc {
  if (id === ROOT_ID) {
    throw new Error(`cannot remove "${ROOT_ID}" — clear the canvas instead`);
  }
  findComponent(doc, id);
  const slotParent = singleSlotParentOf(doc, id);
  if (slotParent !== null) {
    const parent = doc.components.find((c) => c.id === slotParent);
    throw new Error(
      `cannot remove "${id}": it fills a single slot of ${parent?.component ?? 'component'} ` +
        `"${slotParent}" — delete the parent instead, or edit via JSON`,
    );
  }

  const reachableBefore = reachableIds(doc.components);
  const spliced = doc.components.map((c) => {
    if (!Array.isArray(c.children) || !c.children.includes(id)) return c;
    return { ...c, children: c.children.filter((childId) => childId !== id) } as DocComponent;
  });
  const reachableAfter = reachableIds(spliced);
  const dropped = new Set<string>([id]);
  for (const reachable of reachableBefore) {
    if (!reachableAfter.has(reachable)) dropped.add(reachable);
  }
  const components = spliced.filter((c) => !dropped.has(c.id));
  return { ...doc, components };
}

export type MoveVerdict = { ok: true } | { ok: false; reason: string };

/**
 * The target-container half of the §5 move checks, shared by the single and
 * group move ops: `containerId` must name a children-array container
 * (Row/Column/List) whose `children`, when present, is an array. Returns a
 * human-readable refusal reason, or null when the target is legal.
 */
function moveTargetRefusalReason(doc: SurfaceDoc, containerId: string): string | null {
  const container = doc.components.find((c) => c.id === containerId);
  if (!container) {
    return `move target "${containerId}" does not exist in the document`;
  }
  if (!CONTAINER_COMPONENTS.has(container.component)) {
    return (
      `move target "${containerId}" is a ${container.component}, not a container ` +
      `(${[...CONTAINER_COMPONENTS].join(', ')})`
    );
  }
  if (container.children !== undefined && !Array.isArray(container.children)) {
    return `move target "${containerId}" has a non-array "children" property`;
  }
  return null;
}

/**
 * The shared validity checks behind canMoveTo and moveComponent (contract §5).
 * Returns a human-readable refusal reason, or null when the move is legal.
 */
function moveRefusalReason(doc: SurfaceDoc, id: string, containerId: string): string | null {
  if (id === ROOT_ID) {
    return `cannot move "${ROOT_ID}" — the surface root cannot be re-homed`;
  }
  const moved = doc.components.find((c) => c.id === id);
  if (!moved) {
    return `component "${id}" does not exist in the document`;
  }
  const targetReason = moveTargetRefusalReason(doc, containerId);
  if (targetReason !== null) {
    return targetReason;
  }
  const slotParent = singleSlotParentOf(doc, id);
  if (slotParent !== null) {
    const parent = doc.components.find((c) => c.id === slotParent);
    return (
      `cannot move "${id}": it fills a single slot of ${parent?.component ?? 'component'} ` +
      `"${slotParent}" — move the parent instead, or edit via JSON`
    );
  }
  if (containerId === id) {
    return `cannot move "${id}" into itself`;
  }
  if (reachableFrom(doc.components, id).has(containerId)) {
    return `cannot move "${id}" into its own subtree ("${containerId}" is inside it)`;
  }
  return null;
}

/**
 * Whether `id` may be re-homed into `containerId` (contract §5): the same
 * checks as moveComponent, exposed as a verdict so drag surfaces can render
 * no-drop affordances instead of try/catching.
 */
export function canMoveTo(doc: SurfaceDoc, id: string, containerId: string): MoveVerdict {
  const reason = moveRefusalReason(doc, id, containerId);
  return reason === null ? { ok: true } : { ok: false, reason };
}

/**
 * Re-homes a component and its entire subtree (contract §5): splices `id` out
 * of every `children` array that lists it, then splices it into
 * `containerId`'s `children` at `index` — where `index` is interpreted
 * **after the removal**, so a same-container reorder needs no caller-side
 * adjustment (out-of-range indices clamp; non-finite indices land at the
 * end). No id remapping, `dataModel` untouched. Throws exactly when canMoveTo
 * refuses: `root`, unknown `id`/`containerId`, a non-children-array
 * container, single-slot occupants, and `containerId` equal to `id` or
 * inside `id`'s subtree. Pure: never mutates the input.
 */
export function moveComponent(
  doc: SurfaceDoc,
  id: string,
  containerId: string,
  index: number,
): SurfaceDoc {
  const reason = moveRefusalReason(doc, id, containerId);
  if (reason !== null) {
    throw new Error(reason);
  }

  // Removal first: the index is defined against the container's children
  // AFTER the moved id disappears from wherever it currently sits.
  const spliced = doc.components.map((c) => {
    if (!Array.isArray(c.children) || !c.children.includes(id)) return c;
    return { ...c, children: c.children.filter((childId) => childId !== id) } as DocComponent;
  });

  const container = spliced.find((c) => c.id === containerId);
  const existingChildren = container?.children;
  const children: unknown[] = Array.isArray(existingChildren) ? [...existingChildren] : [];
  const at = Number.isFinite(index)
    ? Math.max(0, Math.min(children.length, Math.trunc(index)))
    : children.length;
  children.splice(at, 0, id);

  const components = spliced.map((c) =>
    c.id === containerId ? ({ ...c, children } as DocComponent) : c,
  );
  return { ...doc, components };
}

/**
 * Parent map by first discovery on a breadth-first walk from root of the
 * SAME reference edges as componentTree: `children` arrays, the single
 * slots (Card/Button `child`, Modal `trigger`/`content`, `tabs[].child`),
 * and any other string prop that exactly matches a component id.
 *
 * Determinism rule for multi-parent ids (an id referenced twice): the FIRST
 * parent discovered wins — BFS order makes that the referrer closest to
 * root, with ties at equal depth broken by flat-list/prop order. Each id is
 * assigned a parent at most once (cycle-proof by construction), and ids not
 * reachable from root never get an entry.
 */
function parentMapFromRoot(components: DocComponent[]): Map<string, string> {
  const known = new Set(components.map((c) => c.id));
  const byId = new Map<string, DocComponent>();
  for (const c of components) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  const parentOf = new Map<string, string>();
  const queue: string[] = [ROOT_ID];
  const seen = new Set<string>([ROOT_ID]);
  while (queue.length > 0) {
    const id = queue.shift();
    if (id === undefined) continue;
    const comp = byId.get(id);
    if (!comp) continue;
    const refs = new Set<string>();
    for (const [key, value] of Object.entries(comp)) {
      if (key === 'id' || key === 'component') continue;
      collectReferences(value, known, refs);
    }
    for (const ref of refs) {
      if (seen.has(ref)) continue;
      seen.add(ref);
      parentOf.set(ref, id);
      queue.push(ref);
    }
  }
  return parentOf;
}

/**
 * The inclusive ancestor chain of `id`, deepest-first (contract §7 ancestor
 * honing): `[id, parent, grandparent, …, 'root']`, walking the same
 * reference edges as componentTree — children arrays AND single slots — so
 * a Card's text chains Text → body Column → Card → … → root. Unknown ids
 * yield an empty array. Multi-parent ids resolve deterministically to the
 * first parent found (see parentMapFromRoot). Cycle-guarded twice over: the
 * BFS assigns each id at most one parent, and the upward walk refuses to
 * revisit an id. A component that exists but is unreachable from root has
 * no discovered parent, so its chain is just `[id]` (it cannot end at root).
 */
export function ancestorChainOf(doc: SurfaceDoc, id: string): string[] {
  if (!doc.components.some((c) => c.id === id)) return [];
  const parentOf = parentMapFromRoot(doc.components);
  const chain: string[] = [id];
  const seen = new Set<string>([id]);
  let cursor = parentOf.get(id);
  while (cursor !== undefined && !seen.has(cursor)) {
    chain.push(cursor);
    seen.add(cursor);
    cursor = parentOf.get(cursor);
  }
  return chain;
}

export interface DeletePartition {
  /** Ids removeComponent can take, in selection order (subsumed ids excluded). */
  deletable: string[];
  /** Ids covered by a selected ancestor — deleting the ancestor deletes them. */
  subsumed: string[];
  /** Ids that survive a group delete: root, and single-slot occupants (§5). */
  skipped: string[];
}

/**
 * Splits a selection into what a group delete (contract §4f) actually
 * removes: ids whose PROPER ancestor (ancestorChainOf, so children arrays
 * AND single slots) is also selected are subsumed — their selected ancestor's
 * removal takes the whole subtree, so deleting them separately would either
 * throw (slot occupants) or double-count; of the remaining group roots,
 * `root` and single-slot occupants are skipped (same §5 rules as the single
 * delete), and the rest are deletable. Unknown/stale ids are dropped
 * entirely (they appear in no bucket). Pure; the doc is never touched.
 */
export function partitionForDelete(doc: SurfaceDoc, ids: string[]): DeletePartition {
  const selected = new Set(ids);
  const deletable: string[] = [];
  const subsumed: string[] = [];
  const skipped: string[] = [];
  for (const id of ids) {
    const chain = ancestorChainOf(doc, id);
    if (chain.length === 0) continue; // stale id — not in the doc at all
    if (chain.slice(1).some((ancestor) => selected.has(ancestor))) {
      subsumed.push(id);
    } else if (id === ROOT_ID || singleSlotParentOf(doc, id) !== null) {
      skipped.push(id);
    } else {
      deletable.push(id);
    }
  }
  return { deletable, subsumed, skipped };
}

export interface GroupMovePartition {
  /** Ids moveComponents will re-home, deduped, in document (flat-list) order. */
  movable: string[];
  /** Ids carried by a selected proper ancestor — they travel inside its subtree. */
  subsumed: string[];
  /** Ids that stay put and get reported: root, and single-slot occupants (§5). */
  skipped: string[];
}

/**
 * Splits a selection into what a group move (contract §4e/§5) actually
 * re-homes. The membership rules are exactly partitionForDelete's — ids under
 * a selected proper ancestor are subsumed (the ancestor's subtree carries
 * them), root and single-slot occupants are skipped, stale ids vanish — but
 * the movable remainder is deduped and kept in DOCUMENT order (the flat-list
 * order of doc.components), which is the order the contiguous run inserts in.
 * Pure; the doc is never touched.
 */
export function partitionForMove(doc: SurfaceDoc, ids: string[]): GroupMovePartition {
  const { deletable, subsumed, skipped } = partitionForDelete(doc, ids);
  const order = new Map<string, number>();
  doc.components.forEach((c, i) => {
    if (!order.has(c.id)) order.set(c.id, i);
  });
  const movable = [...new Set(deletable)].sort(
    (a, b) => (order.get(a) ?? doc.components.length) - (order.get(b) ?? doc.components.length),
  );
  return { movable, subsumed, skipped };
}

/**
 * The shared validity checks behind canMoveGroupTo and moveComponents
 * (contract §5): the effective (movable) set must be non-empty, the target
 * must pass the same container checks as the single move, and it may not be
 * any moved id or sit inside ANY moved subtree. Per-member unmovability
 * (root, single-slot occupants) is not a refusal here — those members are
 * partitioned into `skipped` instead.
 */
function groupMoveRefusalReason(
  doc: SurfaceDoc,
  movable: string[],
  containerId: string,
): string | null {
  if (movable.length === 0) {
    return 'nothing movable in the group — root and single-slot occupants stay put';
  }
  const targetReason = moveTargetRefusalReason(doc, containerId);
  if (targetReason !== null) {
    return targetReason;
  }
  for (const id of movable) {
    if (containerId === id) {
      return `cannot move "${id}" into itself`;
    }
    if (reachableFrom(doc.components, id).has(containerId)) {
      return `cannot move "${id}" into its own subtree ("${containerId}" is inside it)`;
    }
  }
  return null;
}

/**
 * Whether the group `ids` may be re-homed into `containerId` (contract §5):
 * the same checks as moveComponents, exposed as a verdict so drag surfaces
 * can render no-drop affordances instead of try/catching. An empty effective
 * set (stale ids, or only root/single-slot members) is `{ok: false}` here,
 * not a throw.
 */
export function canMoveGroupTo(doc: SurfaceDoc, ids: string[], containerId: string): MoveVerdict {
  const { movable } = partitionForMove(doc, ids);
  const reason = groupMoveRefusalReason(doc, movable, containerId);
  return reason === null ? { ok: true } : { ok: false, reason };
}

export interface GroupMoveResult {
  doc: SurfaceDoc;
  /** The effective set actually re-homed, in document order. */
  moved: string[];
  /** Selected members left in place (root, single-slot occupants) — callers toast these. */
  skipped: string[];
}

/**
 * Re-homes a whole selection (contract §5 group move op): the plural of
 * moveComponent with the same target rules. The effective set is `ids`
 * filtered to the doc, subsumption-reduced (a selected proper ancestor
 * carries its descendants), minus the unmovable members (root, single-slot
 * occupants) which come back as `skipped`; the remainder travels in DOCUMENT
 * order. Every effective id is spliced out of every `children` array first,
 * then the run is inserted contiguously into `containerId`'s `children` at
 * `index` — interpreted AFTER every removal (out-of-range indices clamp;
 * non-finite indices land at the end). No id remapping, `dataModel`
 * untouched. Throws exactly when canMoveGroupTo refuses: an empty effective
 * set, an unknown / non-container target, or a target equal to or inside ANY
 * moved subtree. Pure: never mutates the input.
 */
export function moveComponents(
  doc: SurfaceDoc,
  ids: string[],
  containerId: string,
  index: number,
): GroupMoveResult {
  const { movable, skipped } = partitionForMove(doc, ids);
  const reason = groupMoveRefusalReason(doc, movable, containerId);
  if (reason !== null) {
    throw new Error(reason);
  }

  // Removal first: the index is defined against the container's children
  // AFTER every moved id disappears from wherever it currently sits.
  const movedSet = new Set(movable);
  const spliced = doc.components.map((c) => {
    if (!Array.isArray(c.children) || !c.children.some((childId) => movedSet.has(childId))) {
      return c;
    }
    return {
      ...c,
      children: c.children.filter((childId) => !movedSet.has(childId)),
    } as DocComponent;
  });

  const container = spliced.find((c) => c.id === containerId);
  const existingChildren = container?.children;
  const children: unknown[] = Array.isArray(existingChildren) ? [...existingChildren] : [];
  const at = Number.isFinite(index)
    ? Math.max(0, Math.min(children.length, Math.trunc(index)))
    : children.length;
  children.splice(at, 0, ...movable);

  const components = spliced.map((c) =>
    c.id === containerId ? ({ ...c, children } as DocComponent) : c,
  );
  return { doc: { ...doc, components }, moved: movable, skipped };
}

/**
 * Where a glossary insert goes given the current selection (contract §7):
 * the selected component itself if it is a children-array container, else
 * its nearest ancestor (walking the same reference edges as componentTree —
 * through Card/Modal/Tabs slots) that is one, else root.
 */
export function insertTargetFor(doc: SurfaceDoc, selectedId: string | null): string {
  if (selectedId === null) return ROOT_ID;
  const selected = doc.components.find((c) => c.id === selectedId);
  if (!selected) return ROOT_ID;
  if (CONTAINER_COMPONENTS.has(selected.component)) return selectedId;

  const byId = new Map<string, DocComponent>();
  for (const c of doc.components) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  const parentOf = parentMapFromRoot(doc.components);

  let cursor = parentOf.get(selectedId);
  while (cursor !== undefined) {
    const comp = byId.get(cursor);
    if (comp && CONTAINER_COMPONENTS.has(comp.component)) return cursor;
    cursor = parentOf.get(cursor);
  }
  return ROOT_ID;
}

/**
 * Nested view of the flat component list for the tree UI. Children are the
 * component's references in prop order (`children`, `child`, Modal
 * `trigger`/`content`, ...); cycles and repeat references are shown once.
 */
export function componentTree(doc: SurfaceDoc): TreeNode {
  const known = new Set(doc.components.map((c) => c.id));
  const byId = new Map<string, DocComponent>();
  for (const c of doc.components) {
    if (!byId.has(c.id)) byId.set(c.id, c);
  }
  const visited = new Set<string>();
  const build = (id: string): TreeNode => {
    visited.add(id);
    const comp = byId.get(id);
    if (!comp) {
      return { id, component: '(missing)', container: false, children: [] };
    }
    const refs: string[] = [];
    const collect = (value: unknown): void => {
      if (typeof value === 'string') {
        if (known.has(value) && !refs.includes(value)) refs.push(value);
        return;
      }
      if (Array.isArray(value)) {
        for (const v of value) collect(v);
        return;
      }
      if (isRecord(value)) {
        for (const v of Object.values(value)) collect(v);
      }
    };
    for (const [key, value] of Object.entries(comp)) {
      if (key === 'id' || key === 'component') continue;
      collect(value);
    }
    const children: TreeNode[] = [];
    for (const ref of refs) {
      if (!visited.has(ref)) children.push(build(ref));
    }
    return {
      id,
      component: comp.component,
      container: CONTAINER_COMPONENTS.has(comp.component),
      children,
    };
  };
  return build(ROOT_ID);
}
