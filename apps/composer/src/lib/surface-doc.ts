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
