import { describe, expect, it } from 'vitest';
import type { DocComponent, SurfaceDoc } from '../src/lib/surface-doc';
import {
  CATALOG_ID,
  GUARDED_PROP_KEYS,
  ROOT_ID,
  SURFACE_ID,
  ancestorChainOf,
  canMoveTo,
  componentTree,
  emptyDoc,
  insertTargetFor,
  insertUsage,
  listContainers,
  moveComponent,
  nextGen,
  parseRenderMessages,
  removeComponent,
  removeComponentProp,
  setComponentProp,
  singleSlotParentOf,
  toRenderMessages,
} from '../src/lib/surface-doc';
import { welcomeDoc } from '../src/lib/welcome';

function comp(doc: SurfaceDoc, id: string) {
  const found = doc.components.find((c) => c.id === id);
  if (!found) throw new Error(`component ${id} not found`);
  return found;
}

const BUTTON_USAGE = {
  usage: [
    {
      id: 'root',
      component: 'Button',
      child: 'demo-button-child',
      action: { event: { name: 'submit', context: [{ key: 'formId', value: 'contact-form' }] } },
      primary: true,
    },
    { id: 'demo-button-child', component: 'Text', text: 'Submit' },
  ],
};

const MODAL_USAGE = {
  usage: [
    { id: 'root', component: 'Column', children: ['demo-modal'] },
    { id: 'demo-modal', component: 'Modal', trigger: 'demo-btn', content: 'demo-content' },
    { id: 'demo-btn', component: 'Button', child: 'demo-btn-label' },
    { id: 'demo-btn-label', component: 'Text', text: 'Open' },
    { id: 'demo-content', component: 'Text', text: 'Modal content' },
  ],
};

describe('emptyDoc', () => {
  it('is a bare root Column with no children and empty data', () => {
    expect(emptyDoc()).toEqual({
      surfaceId: SURFACE_ID,
      catalogId: CATALOG_ID,
      components: [{ id: 'root', component: 'Column', children: [] }],
      dataModel: {},
    });
  });
});

describe('toRenderMessages', () => {
  it('produces the canonical three-item sequence', () => {
    const doc = emptyDoc();
    const items = toRenderMessages(doc);
    expect(items).toHaveLength(3);
    expect(items[0]).toEqual({
      version: 'v0.9',
      createSurface: { surfaceId: SURFACE_ID, catalogId: CATALOG_ID, sendDataModel: true },
    });
    expect(items[1]).toEqual({
      version: 'v0.9',
      updateComponents: { surfaceId: SURFACE_ID, components: doc.components },
    });
    expect(items[2]).toEqual({
      version: 'v0.9',
      updateDataModel: { surfaceId: SURFACE_ID, value: {} },
    });
  });

  it('does not alias doc internals', () => {
    const doc = emptyDoc();
    const items = toRenderMessages(doc);
    const sent = (items[1]!.updateComponents!.components as Record<string, unknown>[])[0]!;
    (sent.children as unknown[]).push('mutated');
    expect(doc.components[0]!.children).toEqual([]);
  });
});

describe('parseRenderMessages', () => {
  it('round-trips parse(serialize(doc)) deep-equal', () => {
    const doc = welcomeDoc();
    doc.dataModel = { user: { name: 'Ada' }, count: 3 };
    expect(parseRenderMessages(toRenderMessages(doc))).toEqual(doc);
  });

  it('round-trips through JSON text like the drawer does', () => {
    const doc = welcomeDoc();
    const text = JSON.stringify(toRenderMessages(doc), null, 2);
    expect(parseRenderMessages(JSON.parse(text))).toEqual(doc);
  });

  it('accepts official payloads with a foreign surfaceId and a data-model path', () => {
    const doc = parseRenderMessages([
      {
        version: 'v0.9',
        createSurface: { surfaceId: 'sample-surface', catalogId: CATALOG_ID, sendDataModel: true },
      },
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: 'sample-surface',
          components: [
            { id: 'root', component: 'Column', children: ['title'] },
            { id: 'title', component: 'Text', text: 'Book a Car' },
          ],
        },
      },
      {
        version: 'v0.9',
        updateDataModel: {
          surfaceId: 'sample-surface',
          path: '/booking',
          value: { location: '' },
        },
      },
    ]);
    expect(doc.surfaceId).toBe(SURFACE_ID); // normalized to the composer's surface
    expect(doc.components).toHaveLength(2);
    expect(doc.dataModel).toEqual({ booking: { location: '' } });
  });

  it('takes the last createSurface/updateComponents/updateDataModel of the target surface', () => {
    const doc = parseRenderMessages([
      { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'urn:old' } },
      {
        version: 'v0.9',
        updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Row' }] },
      },
      {
        version: 'v0.9',
        updateComponents: { surfaceId: 'other', components: [{ id: 'root', component: 'List' }] },
      },
      { version: 'v0.9', createSurface: { surfaceId: 's', catalogId: 'urn:new' } },
      {
        version: 'v0.9',
        updateComponents: { surfaceId: 's', components: [{ id: 'root', component: 'Column' }] },
      },
      { version: 'v0.9', updateDataModel: { surfaceId: 's', value: { a: 1 } } },
      { version: 'v0.9', updateDataModel: { surfaceId: 's', value: { b: 2 } } },
    ]);
    expect(doc.catalogId).toBe('urn:new');
    expect(comp(doc, 'root').component).toBe('Column');
    expect(doc.dataModel).toEqual({ b: 2 });
  });

  it('preserves unknown component fields', () => {
    const doc = parseRenderMessages([
      {
        version: 'v0.9',
        updateComponents: {
          surfaceId: SURFACE_ID,
          components: [
            { id: 'root', component: 'Column', children: [], futureProp: { deep: [1, 2] } },
          ],
        },
      },
    ]);
    expect(comp(doc, 'root').futureProp).toEqual({ deep: [1, 2] });
  });

  it('defaults missing pieces sanely', () => {
    expect(parseRenderMessages([])).toEqual(emptyDoc());
    const onlyData = parseRenderMessages([
      { version: 'v0.9', updateDataModel: { surfaceId: SURFACE_ID, value: { x: 1 } } },
    ]);
    expect(onlyData.components).toEqual(emptyDoc().components);
    expect(onlyData.dataModel).toEqual({ x: 1 });
  });

  it('throws descriptive errors on malformed input', () => {
    expect(() => parseRenderMessages('nope')).toThrow(/must be a JSON array/);
    expect(() => parseRenderMessages({})).toThrow(/must be a JSON array/);
    expect(() => parseRenderMessages([42])).toThrow(/item 0: expected an object/);
    expect(() => parseRenderMessages([{ updateComponents: 'x' }])).toThrow(/must be an object/);
    expect(() =>
      parseRenderMessages([{ updateComponents: { surfaceId: 's', components: 'x' } }]),
    ).toThrow(/components must be an array/);
    expect(() =>
      parseRenderMessages([
        { updateComponents: { surfaceId: 's', components: [{ component: 'Text' }] } },
      ]),
    ).toThrow(/missing a string "id"/);
    expect(() =>
      parseRenderMessages([{ updateComponents: { surfaceId: 's', components: [{ id: 'a' }] } }]),
    ).toThrow(/missing a string "component"/);
    expect(() =>
      parseRenderMessages([
        { updateComponents: { surfaceId: 's', components: [{ id: 'a', component: 'Text' }] } },
      ]),
    ).toThrow(/no component with id "root"/);
    expect(() =>
      parseRenderMessages([{ updateDataModel: { surfaceId: 's', contents: {} } }]),
    ).toThrow(/"value", not "contents"/);
    expect(() =>
      parseRenderMessages([{ updateDataModel: { surfaceId: 's', value: 'str' } }]),
    ).toThrow(/must be an object when no path/);
  });
});

describe('nextGen', () => {
  it('starts at 1 and is collision-proof against existing -g suffixes', () => {
    expect(nextGen(emptyDoc())).toBe(1);
    const doc = emptyDoc();
    doc.components.push(
      { id: 'a-g3', component: 'Text' },
      { id: 'b-g10', component: 'Text' },
      { id: 'plain', component: 'Text' },
      { id: 'not-gen-g', component: 'Text' },
      { id: 'x-g2y', component: 'Text' },
    );
    expect(nextGen(doc)).toBe(11);
  });
});

describe('insertUsage', () => {
  it('remaps ids (id, child, children) and splices into root by default', () => {
    const doc = insertUsage(emptyDoc(), BUTTON_USAGE);
    expect(comp(doc, ROOT_ID).children).toEqual(['root-g1']);
    const button = comp(doc, 'root-g1');
    expect(button.component).toBe('Button');
    expect(button.child).toBe('demo-button-child-g1');
    expect(comp(doc, 'demo-button-child-g1').text).toBe('Submit');
    // non-id strings (even nested in action context) are untouched
    expect(button.action).toEqual(BUTTON_USAGE.usage[0]!.action);
  });

  it('remaps string props that exactly match snippet ids (Modal trigger/content)', () => {
    const doc = insertUsage(emptyDoc(), MODAL_USAGE);
    const modal = comp(doc, 'demo-modal-g1');
    expect(modal.trigger).toBe('demo-btn-g1');
    expect(modal.content).toBe('demo-content-g1');
    expect(comp(doc, 'root-g1').children).toEqual(['demo-modal-g1']);
  });

  it('remaps snippet-id strings nested deep in props but leaves other strings alone', () => {
    const usage = {
      usage: [
        {
          id: 'root',
          component: 'Tabs',
          tabItems: [{ title: 'First', child: 'pane' }],
          note: 'pane is a word too',
        },
        { id: 'pane', component: 'Text', text: 'hello' },
      ],
    };
    const doc = insertUsage(emptyDoc(), usage);
    const tabs = comp(doc, 'root-g1');
    expect(tabs.tabItems).toEqual([{ title: 'First', child: 'pane-g1' }]);
    expect(tabs.note).toBe('pane is a word too');
  });

  it('splices at the requested index, clamped to the children range', () => {
    let doc = emptyDoc();
    doc.components[0]!.children = ['a', 'b', 'c'];
    doc.components.push(
      { id: 'a', component: 'Text' },
      { id: 'b', component: 'Text' },
      { id: 'c', component: 'Text' },
    );
    const text = { usage: [{ id: 'root', component: 'Text', text: 'x' }] };
    expect(
      comp(insertUsage(doc, text, { containerId: ROOT_ID, index: 0 }), ROOT_ID).children,
    ).toEqual(['root-g1', 'a', 'b', 'c']);
    expect(
      comp(insertUsage(doc, text, { containerId: ROOT_ID, index: 2 }), ROOT_ID).children,
    ).toEqual(['a', 'b', 'root-g1', 'c']);
    expect(
      comp(insertUsage(doc, text, { containerId: ROOT_ID, index: 99 }), ROOT_ID).children,
    ).toEqual(['a', 'b', 'c', 'root-g1']);
    expect(
      comp(insertUsage(doc, text, { containerId: ROOT_ID, index: -5 }), ROOT_ID).children,
    ).toEqual(['root-g1', 'a', 'b', 'c']);
    expect(
      comp(insertUsage(doc, text, { containerId: ROOT_ID, index: null }), ROOT_ID).children,
    ).toEqual(['a', 'b', 'c', 'root-g1']);
    doc = insertUsage(doc, text, { containerId: ROOT_ID });
    expect(comp(doc, ROOT_ID).children).toEqual(['a', 'b', 'c', 'root-g1']);
  });

  it('inserts into nested containers and derives generations per doc', () => {
    let doc = insertUsage(emptyDoc(), {
      usage: [
        { id: 'root', component: 'Card', child: 'inner' },
        { id: 'inner', component: 'Column', children: [] },
      ],
    });
    doc = insertUsage(doc, BUTTON_USAGE, { containerId: 'inner-g1', index: 0 });
    expect(comp(doc, 'inner-g1').children).toEqual(['root-g2']);
    expect(comp(doc, 'root-g2').child).toBe('demo-button-child-g2');
  });

  it('merges usage data shallowly with existing doc keys winning', () => {
    const base = insertUsage(emptyDoc(), {
      usage: [{ id: 'root', component: 'TextField', value: { path: '/user/name' } }],
      data: { user: { name: 'first' }, extra: 1 },
    });
    expect(base.dataModel).toEqual({ user: { name: 'first' }, extra: 1 });
    const merged = insertUsage(base, {
      usage: [{ id: 'root', component: 'TextField', value: { path: '/user/name' } }],
      data: { user: { name: 'second' }, another: 2 },
    });
    expect(merged.dataModel).toEqual({ user: { name: 'first' }, extra: 1, another: 2 });
  });

  it('validates targets: unknown container and non-container both throw', () => {
    const doc = insertUsage(emptyDoc(), BUTTON_USAGE);
    expect(() => insertUsage(doc, BUTTON_USAGE, { containerId: 'nope' })).toThrow(/does not exist/);
    expect(() => insertUsage(doc, BUTTON_USAGE, { containerId: 'demo-button-child-g1' })).toThrow(
      /not a container/,
    );
  });

  it('throws on snippets that would orphan components, leaving the doc unchanged', () => {
    const doc = emptyDoc();
    const before = structuredClone(doc);
    const orphaning = {
      usage: [
        { id: 'root', component: 'Column', children: [] },
        { id: 'unreferenced', component: 'Text', text: 'lost' },
      ],
    };
    expect(() => insertUsage(doc, orphaning)).toThrow(/orphan.*unreferenced/);
    expect(doc).toEqual(before);
  });

  it('throws on snippets without a root component or malformed entries', () => {
    expect(() => insertUsage(emptyDoc(), { usage: [] })).toThrow(/non-empty/);
    expect(() => insertUsage(emptyDoc(), { usage: [{ id: 'a', component: 'Text' }] })).toThrow(
      /no "root" component/,
    );
    expect(() => insertUsage(emptyDoc(), { usage: [{ component: 'Text' }] })).toThrow(
      /missing a string "id"/,
    );
  });

  it('does not mutate its inputs', () => {
    const doc = emptyDoc();
    const docBefore = structuredClone(doc);
    const usageBefore = structuredClone(MODAL_USAGE);
    insertUsage(doc, MODAL_USAGE);
    expect(doc).toEqual(docBefore);
    expect(MODAL_USAGE).toEqual(usageBefore);
  });
});

function docWith(components: DocComponent[]): SurfaceDoc {
  return { surfaceId: SURFACE_ID, catalogId: CATALOG_ID, components, dataModel: {} };
}

/** root Column → [Card(child=cardBody Column → [inner Text]), Tabs, plain Text]. */
function nestedDoc(): SurfaceDoc {
  return docWith([
    { id: ROOT_ID, component: 'Column', children: ['card', 'tabs', 'txt'] },
    { id: 'card', component: 'Card', child: 'cardBody' },
    { id: 'cardBody', component: 'Column', children: ['inner'] },
    { id: 'inner', component: 'Text', text: 'inside the card' },
    {
      id: 'tabs',
      component: 'Tabs',
      tabs: [
        { title: 'A', child: 'paneA' },
        { title: 'B', child: 'paneB' },
      ],
    },
    { id: 'paneA', component: 'Text', text: 'pane a' },
    { id: 'paneB', component: 'Column', children: [] },
    { id: 'txt', component: 'Text', text: 'top level' },
  ]);
}

describe('setComponentProp', () => {
  it('sets a new prop and overwrites an existing one', () => {
    const doc = nestedDoc();
    const withProp = setComponentProp(doc, 'txt', 'variant', 'h2');
    expect(withProp.components.find((c) => c.id === 'txt')!.variant).toBe('h2');
    const overwritten = setComponentProp(withProp, 'txt', 'variant', 'body');
    expect(overwritten.components.find((c) => c.id === 'txt')!.variant).toBe('body');
  });

  it('accepts arbitrary JSON values and deep-clones them in', () => {
    const doc = nestedDoc();
    const value = { style: { color: 'red' }, list: [1, 2] };
    const next = setComponentProp(doc, 'txt', 'meta', value);
    value.list.push(3);
    value.style.color = 'blue';
    expect(next.components.find((c) => c.id === 'txt')!.meta).toEqual({
      style: { color: 'red' },
      list: [1, 2],
    });
    // null / false / 0 are all legal values
    expect(setComponentProp(doc, 'txt', 'x', null).components.find((c) => c.id === 'txt')!.x).toBe(
      null,
    );
    expect(setComponentProp(doc, 'txt', 'x', false).components.find((c) => c.id === 'txt')!.x).toBe(
      false,
    );
  });

  it('throws on unknown ids', () => {
    expect(() => setComponentProp(nestedDoc(), 'nope', 'text', 'x')).toThrow(/does not exist/);
  });

  it('throws for every guarded key (id, component, containment)', () => {
    const doc = nestedDoc();
    expect([...GUARDED_PROP_KEYS].sort()).toEqual([
      'child',
      'children',
      'component',
      'content',
      'id',
      'tabs',
      'trigger',
    ]);
    for (const key of GUARDED_PROP_KEYS) {
      expect(() => setComponentProp(doc, 'txt', key, 'x')).toThrow(/cannot be edited directly/);
    }
  });

  it('is pure: never mutates the input doc (undo snapshots stay valid)', () => {
    const doc = nestedDoc();
    const before = structuredClone(doc);
    setComponentProp(doc, 'txt', 'variant', 'h1');
    expect(doc).toEqual(before);
  });
});

describe('removeComponentProp', () => {
  it('removes an existing prop', () => {
    const doc = setComponentProp(nestedDoc(), 'txt', 'variant', 'h2');
    const next = removeComponentProp(doc, 'txt', 'variant');
    expect('variant' in next.components.find((c) => c.id === 'txt')!).toBe(false);
    // other props untouched
    expect(next.components.find((c) => c.id === 'txt')!.text).toBe('top level');
  });

  it('is a no-op for a key the component does not have', () => {
    const doc = nestedDoc();
    expect(removeComponentProp(doc, 'txt', 'ghost')).toEqual(doc);
  });

  it('throws on unknown ids and guarded keys', () => {
    const doc = nestedDoc();
    expect(() => removeComponentProp(doc, 'nope', 'text')).toThrow(/does not exist/);
    for (const key of GUARDED_PROP_KEYS) {
      expect(() => removeComponentProp(doc, 'card', key)).toThrow(/cannot be edited directly/);
    }
  });

  it('is pure: never mutates the input doc', () => {
    const doc = setComponentProp(nestedDoc(), 'txt', 'variant', 'h2');
    const before = structuredClone(doc);
    removeComponentProp(doc, 'txt', 'variant');
    expect(doc).toEqual(before);
  });
});

describe('singleSlotParentOf', () => {
  it('finds child / trigger / content / tabs[].child slot parents', () => {
    const modal = insertUsage(emptyDoc(), MODAL_USAGE);
    expect(singleSlotParentOf(modal, 'demo-btn-g1')).toBe('demo-modal-g1'); // trigger
    expect(singleSlotParentOf(modal, 'demo-content-g1')).toBe('demo-modal-g1'); // content
    expect(singleSlotParentOf(modal, 'demo-btn-label-g1')).toBe('demo-btn-g1'); // Button child
    const doc = nestedDoc();
    expect(singleSlotParentOf(doc, 'cardBody')).toBe('card'); // Card child
    expect(singleSlotParentOf(doc, 'paneA')).toBe('tabs'); // tabs[].child
    expect(singleSlotParentOf(doc, 'paneB')).toBe('tabs');
  });

  it('returns null for children-array members, root, and unknown ids', () => {
    const doc = nestedDoc();
    expect(singleSlotParentOf(doc, 'card')).toBeNull(); // in root's children array
    expect(singleSlotParentOf(doc, 'txt')).toBeNull();
    expect(singleSlotParentOf(doc, 'inner')).toBeNull(); // in cardBody's children
    expect(singleSlotParentOf(doc, ROOT_ID)).toBeNull();
    expect(singleSlotParentOf(doc, 'nope')).toBeNull();
  });
});

describe('removeComponent', () => {
  it('removes a leaf and splices it out of its parent children array', () => {
    const doc = nestedDoc();
    const next = removeComponent(doc, 'txt');
    expect(next.components.some((c) => c.id === 'txt')).toBe(false);
    expect(next.components.find((c) => c.id === ROOT_ID)!.children).toEqual(['card', 'tabs']);
  });

  it('removes the entire subtree, including nested slot references', () => {
    // Removing the Card takes cardBody (child slot) and inner (grandchild) too.
    const next = removeComponent(nestedDoc(), 'card');
    expect(next.components.map((c) => c.id).sort()).toEqual([
      'paneA',
      'paneB',
      ROOT_ID,
      'tabs',
      'txt',
    ]);
    expect(next.components.find((c) => c.id === ROOT_ID)!.children).toEqual(['tabs', 'txt']);
  });

  it('removes a Modal subtree through trigger/content references', () => {
    const doc = insertUsage(emptyDoc(), MODAL_USAGE);
    // root-g1 is the inserted Column wrapping the whole Modal usage.
    const next = removeComponent(doc, 'root-g1');
    expect(next.components.map((c) => c.id)).toEqual([ROOT_ID]);
    expect(next.components[0]!.children).toEqual([]);
  });

  it('keeps subtree members still referenced from outside the subtree', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: ['col1', 'col2'] },
      { id: 'col1', component: 'Column', children: ['shared', 'only1'] },
      { id: 'col2', component: 'Column', children: ['shared'] },
      { id: 'shared', component: 'Text', text: 'shared' },
      { id: 'only1', component: 'Text', text: 'one' },
    ]);
    const next = removeComponent(doc, 'col1');
    expect(next.components.map((c) => c.id).sort()).toEqual(['col2', ROOT_ID, 'shared']);
  });

  it('splices duplicate references out everywhere', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: ['dup', 'other', 'dup'] },
      { id: 'dup', component: 'Text', text: 'x' },
      { id: 'other', component: 'Text', text: 'y' },
    ]);
    const next = removeComponent(doc, 'dup');
    expect(next.components.find((c) => c.id === ROOT_ID)!.children).toEqual(['other']);
    expect(next.components.some((c) => c.id === 'dup')).toBe(false);
  });

  it('leaves pre-existing orphans alone', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: ['a'] },
      { id: 'a', component: 'Text', text: 'a' },
      { id: 'orphan', component: 'Text', text: 'tolerated JSON paste' },
    ]);
    const next = removeComponent(doc, 'a');
    expect(next.components.map((c) => c.id)).toEqual([ROOT_ID, 'orphan']);
  });

  it('throws for root and unknown ids', () => {
    expect(() => removeComponent(nestedDoc(), ROOT_ID)).toThrow(/cannot remove "root"/);
    expect(() => removeComponent(nestedDoc(), 'nope')).toThrow(/does not exist/);
  });

  it('refuses single-slot occupants (child/trigger/content/tabs[].child)', () => {
    const doc = nestedDoc();
    expect(() => removeComponent(doc, 'cardBody')).toThrow(/single slot of Card "card"/);
    expect(() => removeComponent(doc, 'paneA')).toThrow(/single slot of Tabs "tabs"/);
    const modal = insertUsage(emptyDoc(), MODAL_USAGE);
    expect(() => removeComponent(modal, 'demo-btn-g1')).toThrow(/single slot/);
    expect(() => removeComponent(modal, 'demo-content-g1')).toThrow(/single slot/);
    expect(() => removeComponent(modal, 'demo-btn-label-g1')).toThrow(/single slot/);
    // the error carries the §5 hint
    expect(() => removeComponent(doc, 'cardBody')).toThrow(/delete the parent/);
  });

  it('is pure: never mutates the input doc', () => {
    const doc = nestedDoc();
    const before = structuredClone(doc);
    removeComponent(doc, 'card');
    expect(doc).toEqual(before);
  });
});

/** root Column → [a, b, c] (three Text leaves) for reorder tests. */
function reorderDoc(): SurfaceDoc {
  return docWith([
    { id: ROOT_ID, component: 'Column', children: ['a', 'b', 'c'] },
    { id: 'a', component: 'Text', text: 'a' },
    { id: 'b', component: 'Text', text: 'b' },
    { id: 'c', component: 'Text', text: 'c' },
  ]);
}

describe('moveComponent', () => {
  it('same-container reorder downward: index is interpreted AFTER removal', () => {
    // Moving [a,b,c]'s 'a' to after 'c': the after-removal children are
    // [b,c], so index 2 — NOT 3 — lands it at the end (no off-by-one).
    const doc = moveComponent(reorderDoc(), 'a', ROOT_ID, 2);
    expect(comp(doc, ROOT_ID).children).toEqual(['b', 'c', 'a']);
  });

  it('same-container reorder upward and to middle positions', () => {
    expect(comp(moveComponent(reorderDoc(), 'c', ROOT_ID, 0), ROOT_ID).children).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(comp(moveComponent(reorderDoc(), 'c', ROOT_ID, 1), ROOT_ID).children).toEqual([
      'a',
      'c',
      'b',
    ]);
    expect(comp(moveComponent(reorderDoc(), 'a', ROOT_ID, 1), ROOT_ID).children).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  it('same-position moves leave the order unchanged', () => {
    expect(comp(moveComponent(reorderDoc(), 'b', ROOT_ID, 1), ROOT_ID).children).toEqual([
      'a',
      'b',
      'c',
    ]);
  });

  it('clamps out-of-range and non-finite indices', () => {
    expect(comp(moveComponent(reorderDoc(), 'a', ROOT_ID, 99), ROOT_ID).children).toEqual([
      'b',
      'c',
      'a',
    ]);
    expect(comp(moveComponent(reorderDoc(), 'c', ROOT_ID, -7), ROOT_ID).children).toEqual([
      'c',
      'a',
      'b',
    ]);
    expect(comp(moveComponent(reorderDoc(), 'a', ROOT_ID, Number.NaN), ROOT_ID).children).toEqual([
      'b',
      'c',
      'a',
    ]);
  });

  it('cross-container move re-homes the whole subtree intact: no remap, dataModel untouched', () => {
    const doc = nestedDoc();
    doc.dataModel = { keep: true };
    // card (Card → cardBody Column → inner Text) into paneB (Column in a Tabs slot)
    const moved = moveComponent(doc, 'card', 'paneB', 0);
    expect(comp(moved, ROOT_ID).children).toEqual(['tabs', 'txt']);
    expect(comp(moved, 'paneB').children).toEqual(['card']);
    // subtree traveled intact — same ids, same membership, no remapping
    expect(moved.components.map((c) => c.id).sort()).toEqual(
      doc.components.map((c) => c.id).sort(),
    );
    expect(comp(moved, 'card').child).toBe('cardBody');
    expect(comp(moved, 'cardBody').children).toEqual(['inner']);
    expect(moved.dataModel).toBe(doc.dataModel);
  });

  it('moves into a container that has no children property yet', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: ['row', 'x'] },
      { id: 'row', component: 'Row' },
      { id: 'x', component: 'Text', text: 'x' },
    ]);
    const moved = moveComponent(doc, 'x', 'row', 5);
    expect(comp(moved, ROOT_ID).children).toEqual(['row']);
    expect(comp(moved, 'row').children).toEqual(['x']);
  });

  it('splices duplicate listings out everywhere and inserts exactly once', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: ['x', 'y', 'x'] },
      { id: 'x', component: 'Text', text: 'x' },
      { id: 'y', component: 'Column', children: [] },
    ]);
    const moved = moveComponent(doc, 'x', 'y', 0);
    expect(comp(moved, ROOT_ID).children).toEqual(['y']);
    expect(comp(moved, 'y').children).toEqual(['x']);
  });

  it('re-homes tolerated orphans back into the tree', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: [] },
      { id: 'stray', component: 'Text', text: 'found' },
    ]);
    expect(comp(moveComponent(doc, 'stray', ROOT_ID, 0), ROOT_ID).children).toEqual(['stray']);
  });

  it('throws for root, unknown ids, unknown targets, and non-container targets', () => {
    const doc = nestedDoc();
    expect(() => moveComponent(doc, ROOT_ID, 'cardBody', 0)).toThrow(/cannot move "root"/);
    expect(() => moveComponent(doc, 'nope', 'cardBody', 0)).toThrow(/"nope" does not exist/);
    expect(() => moveComponent(doc, 'txt', 'gone', 0)).toThrow(/"gone" does not exist/);
    expect(() => moveComponent(doc, 'txt', 'card', 0)).toThrow(/is a Card, not a container/);
    expect(() => moveComponent(doc, 'txt', 'inner', 0)).toThrow(/not a container/);
  });

  it('refuses single-slot occupants (child / tabs[].child), like the remove op', () => {
    const doc = nestedDoc();
    expect(() => moveComponent(doc, 'cardBody', ROOT_ID, 0)).toThrow(/single slot of Card "card"/);
    expect(() => moveComponent(doc, 'paneA', ROOT_ID, 0)).toThrow(/single slot of Tabs "tabs"/);
  });

  it('refuses moving into itself or anywhere inside its own subtree', () => {
    const doc = nestedDoc();
    // cardBody is reached from card through the Card child slot
    expect(() => moveComponent(doc, 'card', 'cardBody', 0)).toThrow(/own subtree.*cardBody/);
    const col = docWith([
      { id: ROOT_ID, component: 'Column', children: ['col'] },
      { id: 'col', component: 'Column', children: [] },
    ]);
    expect(() => moveComponent(col, 'col', 'col', 0)).toThrow(/into itself/);
  });

  it('refuses a target container whose children is not an array', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: ['bad', 'x'] },
      { id: 'bad', component: 'Row', children: 'oops' },
      { id: 'x', component: 'Text', text: 'x' },
    ]);
    expect(() => moveComponent(doc, 'x', 'bad', 0)).toThrow(/non-array "children"/);
  });

  it('is pure: never mutates the input doc', () => {
    const doc = nestedDoc();
    const before = structuredClone(doc);
    moveComponent(doc, 'txt', 'cardBody', 0);
    expect(doc).toEqual(before);
  });
});

describe('canMoveTo', () => {
  it('returns ok for legal moves', () => {
    const doc = nestedDoc();
    expect(canMoveTo(doc, 'card', 'paneB')).toEqual({ ok: true });
    expect(canMoveTo(doc, 'txt', 'cardBody')).toEqual({ ok: true });
    expect(canMoveTo(doc, 'inner', ROOT_ID)).toEqual({ ok: true });
    // a same-container "reorder" is a legal move too
    expect(canMoveTo(doc, 'txt', ROOT_ID)).toEqual({ ok: true });
  });

  it('mirrors every moveComponent refusal as {ok:false, reason} with the same message', () => {
    const doc = nestedDoc();
    const cases: [string, string, RegExp][] = [
      [ROOT_ID, 'cardBody', /cannot move "root"/],
      ['nope', ROOT_ID, /does not exist/],
      ['txt', 'gone', /does not exist/],
      ['txt', 'card', /not a container/],
      ['cardBody', ROOT_ID, /single slot/],
      ['paneA', ROOT_ID, /single slot/],
      ['card', 'cardBody', /own subtree/],
    ];
    for (const [id, containerId, pattern] of cases) {
      const verdict = canMoveTo(doc, id, containerId);
      expect(verdict.ok).toBe(false);
      if (verdict.ok) continue;
      expect(verdict.reason).toMatch(pattern);
      // the throwing op uses the exact same message (toThrow substring match)
      expect(() => moveComponent(doc, id, containerId, 0)).toThrow(verdict.reason);
    }
  });
});

describe('insertTargetFor', () => {
  it('is root for null and unknown selections', () => {
    const doc = nestedDoc();
    expect(insertTargetFor(doc, null)).toBe(ROOT_ID);
    expect(insertTargetFor(doc, 'nope')).toBe(ROOT_ID);
  });

  it('is the selection itself when it is a children-array container', () => {
    const doc = nestedDoc();
    expect(insertTargetFor(doc, ROOT_ID)).toBe(ROOT_ID);
    expect(insertTargetFor(doc, 'cardBody')).toBe('cardBody');
    expect(insertTargetFor(doc, 'paneB')).toBe('paneB'); // Column inside a Tabs slot
  });

  it('walks through Card/Modal/Tabs slots to the nearest containing Column', () => {
    const doc = nestedDoc();
    expect(insertTargetFor(doc, 'inner')).toBe('cardBody'); // Text → its Column
    expect(insertTargetFor(doc, 'card')).toBe(ROOT_ID); // Card → root Column
    expect(insertTargetFor(doc, 'tabs')).toBe(ROOT_ID); // Tabs → root Column
    expect(insertTargetFor(doc, 'paneA')).toBe(ROOT_ID); // Text in a tab slot → through Tabs
    expect(insertTargetFor(doc, 'txt')).toBe(ROOT_ID);
    const modal = insertUsage(emptyDoc(), MODAL_USAGE);
    // Button label → through Button and Modal to the inserted Column
    expect(insertTargetFor(modal, 'demo-btn-label-g1')).toBe('root-g1');
    expect(insertTargetFor(modal, 'demo-content-g1')).toBe('root-g1');
  });

  it('falls back to root for unreachable non-containers', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: [] },
      { id: 'orphan', component: 'Text', text: 'x' },
    ]);
    expect(insertTargetFor(doc, 'orphan')).toBe(ROOT_ID);
  });
});

describe('listContainers / componentTree', () => {
  it('lists only children-array container ids (Modal is a single-slot leaf)', () => {
    const doc = insertUsage(emptyDoc(), MODAL_USAGE);
    expect(listContainers(doc)).toEqual(['root', 'root-g1']);
  });

  it('builds a nested tree following children, child, and string references', () => {
    const doc = insertUsage(emptyDoc(), MODAL_USAGE);
    const tree = componentTree(doc);
    expect(tree.id).toBe('root');
    expect(tree.container).toBe(true);
    const column = tree.children[0]!;
    expect(column.id).toBe('root-g1');
    const modal = column.children[0]!;
    expect(modal.id).toBe('demo-modal-g1');
    expect(modal.children.map((n) => n.id)).toEqual(['demo-btn-g1', 'demo-content-g1']);
    expect(modal.children[0]!.children.map((n) => n.id)).toEqual(['demo-btn-label-g1']);
  });

  it('survives cycles and repeated references', () => {
    const doc = emptyDoc();
    doc.components[0]!.children = ['a'];
    doc.components.push(
      { id: 'a', component: 'Column', children: ['b', 'b'] },
      { id: 'b', component: 'Column', children: ['a'] },
    );
    const tree = componentTree(doc);
    const a = tree.children[0]!;
    expect(a.id).toBe('a');
    expect(a.children.map((n) => n.id)).toEqual(['b']);
    expect(a.children[0]!.children).toEqual([]);
  });
});

describe('ancestorChainOf', () => {
  it('is deepest-first, inclusive, and ends at root', () => {
    const doc = nestedDoc();
    expect(ancestorChainOf(doc, 'txt')).toEqual(['txt', ROOT_ID]);
    expect(ancestorChainOf(doc, 'cardBody')).toEqual(['cardBody', 'card', ROOT_ID]);
  });

  it('hops single slots exactly like the tree: Card child, Tabs panes, Modal trigger/content', () => {
    const doc = nestedDoc();
    // Card's text: Text → its Column body → through the Card `child` slot → root
    expect(ancestorChainOf(doc, 'inner')).toEqual(['inner', 'cardBody', 'card', ROOT_ID]);
    // Tabs pane: through `tabs[].child`
    expect(ancestorChainOf(doc, 'paneA')).toEqual(['paneA', 'tabs', ROOT_ID]);
    // Modal usage: Button label → Button `child` → Modal `trigger` → Column → root
    const modal = insertUsage(emptyDoc(), MODAL_USAGE);
    expect(ancestorChainOf(modal, 'demo-btn-label-g1')).toEqual([
      'demo-btn-label-g1',
      'demo-btn-g1',
      'demo-modal-g1',
      'root-g1',
      ROOT_ID,
    ]);
    expect(ancestorChainOf(modal, 'demo-content-g1')).toEqual([
      'demo-content-g1',
      'demo-modal-g1',
      'root-g1',
      ROOT_ID,
    ]);
  });

  it("root's chain is just itself; unknown ids yield an empty array", () => {
    const doc = nestedDoc();
    expect(ancestorChainOf(doc, ROOT_ID)).toEqual([ROOT_ID]);
    expect(ancestorChainOf(doc, 'no-such-id')).toEqual([]);
    expect(ancestorChainOf(emptyDoc(), '')).toEqual([]);
  });

  it('is cycle-guarded: a reference cycle still terminates at root', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: ['a'] },
      { id: 'a', component: 'Column', children: ['b'] },
      { id: 'b', component: 'Column', children: ['a'] }, // b → a → b …
    ]);
    expect(ancestorChainOf(doc, 'b')).toEqual(['b', 'a', ROOT_ID]);
    expect(ancestorChainOf(doc, 'a')).toEqual(['a', ROOT_ID]);
  });

  it('resolves multi-parent ids to the first parent found (BFS from root, list order)', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: ['x', 'y'] },
      { id: 'x', component: 'Column', children: ['shared'] },
      { id: 'y', component: 'Column', children: ['shared'] }, // second referrer loses
      { id: 'shared', component: 'Text', text: 's' },
    ]);
    expect(ancestorChainOf(doc, 'shared')).toEqual(['shared', 'x', ROOT_ID]);
  });

  it('stops at a component unreachable from root (no discovered parent)', () => {
    const doc = docWith([
      { id: ROOT_ID, component: 'Column', children: [] },
      { id: 'orphan', component: 'Text', text: 'x' },
    ]);
    expect(ancestorChainOf(doc, 'orphan')).toEqual(['orphan']);
  });
});
