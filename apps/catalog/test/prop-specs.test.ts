/**
 * Contract section 4d: prop-spec derivation exercised against the REAL
 * brandedBasicCatalog (and therefore the real zod schemas installed with
 * @a2ui/web_core@0.10.6 / zod@3.25.76 — the classic v3 API with
 * `_def.typeName` internals, which this suite implicitly pins).
 */

import { describe, expect, it } from 'vitest';
import { brandedBasicCatalog } from '../src/branded-catalog';
import {
  CONTAINMENT_PROPS,
  derivePropSpec,
  derivePropSpecs,
  type PropSpec,
} from '../src/prop-specs';

const specs = derivePropSpecs(brandedBasicCatalog);

function prop(component: string, name: string): PropSpec {
  const entry = specs[component];
  expect(entry, `no spec entry for ${component}`).toBeDefined();
  const found = entry!.props.find((p) => p.name === name);
  expect(found, `${component}.${name} missing`).toBeDefined();
  return found!;
}

describe('derivePropSpecs against the real basic catalog', () => {
  it('yields a spec entry with props for every one of the 18 components', () => {
    const names = [...brandedBasicCatalog.components.keys()];
    expect(names).toHaveLength(18);
    for (const name of names) {
      expect(specs, `missing ${name}`).toHaveProperty(name);
      expect(specs[name]!.props.length, `${name} has no props`).toBeGreaterThan(0);
    }
    expect(Object.keys(specs)).toHaveLength(18);
  });

  it('the branded wrapper preserves name+schema on every implementation', () => {
    for (const [name, impl] of brandedBasicCatalog.components) {
      expect(impl.name).toBe(name);
      expect(impl.schema, `${name} lost its schema in wrapping`).toBeDefined();
      expect(typeof (impl.schema as { safeParse?: unknown }).safeParse).toBe('function');
    }
  });

  it('Text: bindable string text (required) + variant enum', () => {
    expect(prop('Text', 'text')).toMatchObject({
      kind: 'string',
      bindable: true,
      required: true,
    });
    const variant = prop('Text', 'variant');
    expect(variant.kind).toBe('enum');
    expect(variant.required).toBe(false);
    expect(variant.options).toEqual(['h1', 'h2', 'h3', 'h4', 'h5', 'caption', 'body']);
  });

  it("Button: variant enum including 'primary', containment child, json action", () => {
    const variant = prop('Button', 'variant');
    expect(variant.kind).toBe('enum');
    expect(variant.options).toContain('primary');
    expect(variant.options).toEqual(['default', 'primary', 'borderless']);

    const child = prop('Button', 'child');
    expect(child.containment).toBe(true);
    expect(child.kind).toBe('string');
    expect(child.required).toBe(true);

    const action = prop('Button', 'action');
    expect(action.kind).toBe('json');
    expect(action.required).toBe(false);
    expect(action.containment).toBeUndefined();
  });

  it('Slider: number min/max, bindable number value', () => {
    expect(prop('Slider', 'min')).toMatchObject({ kind: 'number', required: false });
    expect(prop('Slider', 'max')).toMatchObject({ kind: 'number', required: true });
    expect(prop('Slider', 'value')).toMatchObject({
      kind: 'number',
      bindable: true,
      required: true,
    });
  });

  it('CheckBox: bindable boolean value + bindable string label', () => {
    expect(prop('CheckBox', 'value')).toMatchObject({
      kind: 'boolean',
      bindable: true,
      required: true,
    });
    expect(prop('CheckBox', 'label')).toMatchObject({ kind: 'string', bindable: true });
  });

  it('containment props are marked on every container-ish component', () => {
    expect(prop('Row', 'children').containment).toBe(true);
    expect(prop('Column', 'children').containment).toBe(true);
    expect(prop('List', 'children').containment).toBe(true);
    expect(prop('Card', 'child').containment).toBe(true);
    expect(prop('Modal', 'trigger').containment).toBe(true);
    expect(prop('Modal', 'content').containment).toBe(true);
    const tabs = prop('Tabs', 'tabs');
    expect(tabs.containment).toBe(true);
    expect(tabs.kind).toBe('json'); // array of {title, child}
    expect(CONTAINMENT_PROPS.has('children')).toBe(true);
  });

  it('DateTimeInput min/max flatten the nested DynamicString union to bindable string', () => {
    expect(prop('DateTimeInput', 'min')).toMatchObject({
      kind: 'string',
      bindable: true,
      required: false,
    });
    expect(prop('DateTimeInput', 'max')).toMatchObject({ kind: 'string', bindable: true });
  });

  it('Icon name: enum of icon names (union with path/svgPath objects)', () => {
    const name = prop('Icon', 'name');
    expect(name.kind).toBe('enum');
    expect(name.options).toContain('star');
    expect(name.options?.length).toBe(59);
    // The {path} member makes it structurally bindable.
    expect(name.bindable).toBe(true);
  });

  it('unhandled shapes fall back to json (accessibility object, checks array, options list)', () => {
    expect(prop('Text', 'accessibility')).toMatchObject({ kind: 'json', required: false });
    expect(prop('Button', 'checks')).toMatchObject({ kind: 'json', required: false });
    expect(prop('ChoicePicker', 'options')).toMatchObject({ kind: 'json', required: true });
    // DynamicStringList: union of array + {path} — json but bindable.
    expect(prop('ChoicePicker', 'value')).toMatchObject({ kind: 'json', bindable: true });
    expect(prop('Text', 'weight')).toMatchObject({ kind: 'number', required: false });
  });
});

describe('derivePropSpecs robustness', () => {
  it('never throws on weird schemas: json per prop, skip components without one', () => {
    const throwingShape = {
      _def: {
        typeName: 'ZodObject',
        shape: () => {
          throw new Error('boom');
        },
      },
      get shape(): never {
        throw new Error('boom');
      },
    };
    const weirdProp = { _def: { typeName: 'ZodMystery' } };
    const throwingProp = {
      get _def(): never {
        throw new Error('boom');
      },
    };
    const okShape = {
      _def: { typeName: 'ZodObject' },
      shape: { weird: weirdProp, throwing: throwingProp },
    };
    const catalog = {
      components: new Map<string, unknown>([
        ['NoSchema', { name: 'NoSchema' }],
        ['NullSchema', { name: 'NullSchema', schema: null }],
        ['NotAnObject', { name: 'NotAnObject', schema: { _def: { typeName: 'ZodString' } } }],
        ['Throwing', { name: 'Throwing', schema: throwingShape }],
        ['Weird', { name: 'Weird', schema: okShape }],
      ]),
    };
    const derived = derivePropSpecs(catalog);
    expect(Object.keys(derived)).toEqual(['Weird']);
    expect(derived['Weird']!.props).toEqual([
      { name: 'weird', kind: 'json', required: true },
      // The throwing prop takes the catch path, which omits `required`.
      { name: 'throwing', kind: 'json' },
    ]);
  });

  it('derivePropSpec falls back to json (keeping containment) when unwrap explodes', () => {
    const bomb = {
      get _def(): never {
        throw new Error('kaboom');
      },
    };
    expect(derivePropSpec('children', bomb)).toEqual({
      name: 'children',
      kind: 'json',
      containment: true,
    });
    expect(derivePropSpec('title', bomb)).toEqual({ name: 'title', kind: 'json' });
  });
});
