/**
 * COMPOSERX prop-spec derivation (contract section 4d): walks the REAL zod
 * schemas carried by the basic catalog's component implementations and maps
 * each prop to a widget-friendly `PropSpec`.
 *
 * Zod-version note (verified by test/prop-specs.test.ts against the installed
 * packages, not from memory): `@a2ui/web_core@0.10.6` imports the classic
 * `zod` entry of zod@3.25.76, i.e. the **v3 API** — every schema exposes
 * `_def.typeName` strings ('ZodObject', 'ZodOptional', 'ZodUnion', ...),
 * `_def.innerType` on wrappers, `_def.options` on unions, `_def.values` on
 * enums, and a `.shape` getter on objects. The accessors below read those v3
 * internals first and fall back to the zod v4 layout (`_zod.def.type` with
 * lowercase type names) on a best-effort basis, so a future dependency bump
 * degrades to `'json'` specs instead of crashing. Nothing in this module may
 * throw: unknown shapes become `kind: 'json'`, components without a usable
 * object schema are skipped.
 */

export type PropKind = 'string' | 'number' | 'boolean' | 'enum' | 'json';

export interface PropSpec {
  name: string;
  kind: PropKind;
  /** Allowed values, only for kind 'enum'. */
  options?: string[];
  /** True when the prop is not optional/defaulted in the schema. */
  required?: boolean;
  /** True when the schema is a union admitting a `{path}` data binding. */
  bindable?: boolean;
  /** children/child/trigger/content/tabs — read-only in the inspector. */
  containment?: boolean;
}

export type PropSpecsPayload = Record<string, { props: PropSpec[] }>;

/** Fixed containment prop names (contract sections 3 and 4d). */
export const CONTAINMENT_PROPS: ReadonlySet<string> = new Set([
  'children',
  'child',
  'trigger',
  'content',
  'tabs',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/** zod v3 `_def` (or null). */
function v3Def(schema: unknown): Record<string, unknown> | null {
  if (!isRecord(schema)) return null;
  const def = schema['_def'];
  return isRecord(def) ? def : null;
}

/** zod v4 `_zod.def` (or null) — best-effort fallback only. */
function v4Def(schema: unknown): Record<string, unknown> | null {
  if (!isRecord(schema)) return null;
  const internals = schema['_zod'];
  if (!isRecord(internals)) return null;
  const def = internals['def'];
  return isRecord(def) ? def : null;
}

/**
 * Normalized type name in zod v3 spelling ('ZodOptional', 'ZodString', ...).
 * v3: `_def.typeName` verbatim; v4: `_zod.def.type` ('optional') capitalized.
 */
function typeNameOf(schema: unknown): string | null {
  const def3 = v3Def(schema);
  if (def3 !== null && typeof def3['typeName'] === 'string') return def3['typeName'];
  const def4 = v4Def(schema);
  if (def4 !== null && typeof def4['type'] === 'string') {
    const t = def4['type'];
    return `Zod${t.charAt(0).toUpperCase()}${t.slice(1)}`;
  }
  return null;
}

function defField(schema: unknown, key: string): unknown {
  const def3 = v3Def(schema);
  if (def3 !== null && def3[key] !== undefined) return def3[key];
  const def4 = v4Def(schema);
  if (def4 !== null && def4[key] !== undefined) return def4[key];
  return undefined;
}

/** Object-schema shape: v3 `.shape` getter (or `_def.shape()`), v4 `def.shape`. */
function shapeOf(schema: unknown): Record<string, unknown> | null {
  if (typeNameOf(schema) !== 'ZodObject') return null;
  if (isRecord(schema)) {
    const shape = schema['shape'];
    if (isRecord(shape)) return shape;
  }
  const defShape = defField(schema, 'shape');
  if (typeof defShape === 'function') {
    const produced = (defShape as () => unknown)();
    if (isRecord(produced)) return produced;
  }
  if (isRecord(defShape)) return defShape;
  return null;
}

/** Enum values as strings: v3 `_def.values` array, v4 `def.entries` record. */
function enumValuesOf(schema: unknown): string[] {
  const values = defField(schema, 'values');
  if (Array.isArray(values)) {
    return values.filter((v): v is string => typeof v === 'string');
  }
  const entries = defField(schema, 'entries');
  if (isRecord(entries)) {
    return Object.values(entries).filter((v): v is string => typeof v === 'string');
  }
  return [];
}

function unionMembersOf(schema: unknown): unknown[] {
  const options = defField(schema, 'options');
  return Array.isArray(options) ? options : [];
}

const WRAPPER_TYPES: ReadonlySet<string> = new Set(['ZodOptional', 'ZodDefault', 'ZodNullable']);

/**
 * Strips ZodOptional/ZodDefault/ZodNullable wrappers. `required` turns false
 * for optional/default (the key may be omitted); nullable alone keeps it.
 */
function unwrap(schema: unknown): { schema: unknown; required: boolean } {
  let current = schema;
  let required = true;
  for (let depth = 0; depth < 16; depth++) {
    const typeName = typeNameOf(current);
    if (typeName === null || !WRAPPER_TYPES.has(typeName)) break;
    if (typeName === 'ZodOptional' || typeName === 'ZodDefault') required = false;
    const inner = defField(current, 'innerType');
    if (inner === undefined || inner === null) break;
    current = inner;
  }
  return { schema: current, required };
}

function scalarKindOf(typeName: string | null): 'string' | 'number' | 'boolean' | null {
  if (typeName === 'ZodString') return 'string';
  if (typeName === 'ZodNumber') return 'number';
  if (typeName === 'ZodBoolean') return 'boolean';
  return null;
}

/** Flattens union members (unwrapping each and inlining nested unions). */
function flattenUnion(schema: unknown, out: unknown[], depth: number): void {
  for (const member of unionMembersOf(schema)) {
    const inner = unwrap(member).schema;
    if (typeNameOf(inner) === 'ZodUnion' && depth < 4) {
      flattenUnion(inner, out, depth + 1);
    } else {
      out.push(inner);
    }
  }
}

interface DerivedKind {
  kind: PropKind;
  options?: string[];
  bindable?: boolean;
}

/**
 * Classifies an unwrapped schema (contract section 4d):
 * scalar → its kind; enum → 'enum' + options; union of one scalar kind (or of
 * enums) with a `{path}`-shaped object → that kind + bindable; everything
 * else (objects, arrays, records, action/function-call unions) → 'json'.
 */
function deriveKind(schema: unknown): DerivedKind {
  const typeName = typeNameOf(schema);
  const scalar = scalarKindOf(typeName);
  if (scalar !== null) return { kind: scalar };
  if (typeName === 'ZodEnum') {
    const options = enumValuesOf(schema);
    if (options.length > 0) return { kind: 'enum', options };
    return { kind: 'json' };
  }
  if (typeName === 'ZodUnion') {
    const members: unknown[] = [];
    flattenUnion(schema, members, 0);
    const scalarKinds = new Set<'string' | 'number' | 'boolean'>();
    const enumOptions: string[] = [];
    let hasEnum = false;
    let hasPathObject = false;
    for (const member of members) {
      const memberType = typeNameOf(member);
      const memberScalar = scalarKindOf(memberType);
      if (memberScalar !== null) {
        scalarKinds.add(memberScalar);
        continue;
      }
      if (memberType === 'ZodEnum') {
        hasEnum = true;
        enumOptions.push(...enumValuesOf(member));
        continue;
      }
      if (memberType === 'ZodObject') {
        const shape = shapeOf(member);
        if (shape !== null && 'path' in shape) hasPathObject = true;
      }
    }
    const bindable = hasPathObject ? true : undefined;
    if (scalarKinds.size === 1 && !hasEnum) {
      const [kind] = scalarKinds;
      return { kind: kind as PropKind, bindable };
    }
    if (hasEnum && scalarKinds.size === 0 && enumOptions.length > 0) {
      return { kind: 'enum', options: [...new Set(enumOptions)], bindable };
    }
    return { kind: 'json', bindable };
  }
  return { kind: 'json' };
}

/** Derives one PropSpec; never throws (falls back to kind 'json'). */
export function derivePropSpec(name: string, schema: unknown): PropSpec {
  const containment = CONTAINMENT_PROPS.has(name) ? true : undefined;
  try {
    const { schema: inner, required } = unwrap(schema);
    const { kind, options, bindable } = deriveKind(inner);
    const spec: PropSpec = { name, kind, required };
    if (options !== undefined) spec.options = options;
    if (bindable !== undefined) spec.bindable = bindable;
    if (containment !== undefined) spec.containment = containment;
    return spec;
  } catch {
    const fallback: PropSpec = { name, kind: 'json' };
    if (containment !== undefined) fallback.containment = containment;
    return fallback;
  }
}

/**
 * Derives the COMPOSERX_PROP_SPECS payload body from a catalog whose
 * components map entries carry `.schema` (the branded catalog preserves
 * name+schema from `@a2ui/web_core`'s ComponentApi objects — asserted in
 * tests). Components without a usable object schema are skipped; a component
 * whose shape walk throws is skipped too.
 */
export function derivePropSpecs(catalog: {
  components: ReadonlyMap<string, unknown>;
}): PropSpecsPayload {
  const result: PropSpecsPayload = {};
  let entries: Iterable<[string, unknown]>;
  try {
    entries = [...catalog.components.entries()];
  } catch {
    return result;
  }
  for (const [name, impl] of entries) {
    try {
      if (!isRecord(impl)) continue;
      const shape = shapeOf(impl['schema']);
      if (shape === null) continue;
      const props: PropSpec[] = [];
      for (const [propName, propSchema] of Object.entries(shape)) {
        props.push(derivePropSpec(propName, propSchema));
      }
      result[name] = { props };
    } catch {
      // Weird schema: skip this component rather than fail the payload.
    }
  }
  return result;
}
