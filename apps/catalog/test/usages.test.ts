import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { COMPONENT_USAGES } from '../src/usages';
import { brandedBasicCatalog } from '../src/branded-catalog';

// vitest runs with cwd at the package root (apps/catalog).
const catalogJson = JSON.parse(readFileSync(join(process.cwd(), 'public/catalog'), 'utf8')) as {
  catalogId: string;
  components: Record<string, { name: string }>;
};

const catalogComponentNames = new Set(Object.keys(catalogJson.components));

function collectIdReferences(entry: Record<string, unknown>): string[] {
  const refs: string[] = [];
  if (Array.isArray(entry.children)) {
    refs.push(...entry.children.filter((c): c is string => typeof c === 'string'));
  }
  for (const key of ['child', 'trigger', 'content']) {
    const value = entry[key];
    if (typeof value === 'string') refs.push(value);
  }
  if (Array.isArray(entry.tabs)) {
    for (const tab of entry.tabs) {
      if (
        tab &&
        typeof tab === 'object' &&
        typeof (tab as { child?: unknown }).child === 'string'
      ) {
        refs.push((tab as { child: string }).child);
      }
    }
  }
  return refs;
}

describe('public/catalog', () => {
  it('serves the pinned basic-catalog URN with all 18 components', () => {
    expect(catalogJson.catalogId).toBe('https://a2ui.org/specification/v0_9/basic_catalog.json');
    expect(catalogComponentNames.size).toBe(18);
  });
});

describe('COMPONENT_USAGES', () => {
  it('covers every component in the served catalog', () => {
    for (const name of catalogComponentNames) {
      expect(COMPONENT_USAGES, `missing usage for ${name}`).toHaveProperty(name);
      expect(COMPONENT_USAGES[name]?.usage.length).toBeGreaterThan(0);
    }
  });

  it('references only components that exist in the catalog', () => {
    for (const [name, { usage }] of Object.entries(COMPONENT_USAGES)) {
      for (const entry of usage) {
        expect(
          catalogComponentNames.has(String(entry.component)),
          `${name}: unknown component ${String(entry.component)}`,
        ).toBe(true);
      }
    }
  });

  it('resolves every child/children/trigger/content/tab reference within its own snippet', () => {
    for (const [name, { usage }] of Object.entries(COMPONENT_USAGES)) {
      const ids = new Set(usage.map((entry) => String(entry.id)));
      for (const entry of usage) {
        for (const ref of collectIdReferences(entry)) {
          expect(ids.has(ref), `${name}: dangling id reference ${ref}`).toBe(true);
        }
      }
    }
  });

  it('has a root component in every snippet (the composer splices it on insert)', () => {
    for (const [name, { usage }] of Object.entries(COMPONENT_USAGES)) {
      expect(
        usage.some((entry) => entry.id === 'root'),
        `${name}: no root component`,
      ).toBe(true);
    }
  });

  it('parses every usage entry against the rendered catalog schemas', () => {
    for (const [name, { usage }] of Object.entries(COMPONENT_USAGES)) {
      for (const entry of usage) {
        const { id, component, ...properties } = entry;
        const impl = brandedBasicCatalog.components.get(String(component));
        expect(impl, `${name}: no implementation for ${String(component)}`).toBeDefined();
        const result = impl!.schema.safeParse(properties);
        expect(
          result.success,
          `${name}/${String(id)}: ${result.success ? 'ok' : result.error.message}`,
        ).toBe(true);
      }
    }
  });
});
