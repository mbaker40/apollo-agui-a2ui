import { describe, expect, it } from 'vitest';
import type { SurfaceDoc } from '../src/lib/surface-doc';
import {
  CATALOG_ID,
  ROOT_ID,
  SURFACE_ID,
  componentTree,
  emptyDoc,
  insertUsage,
  listContainers,
  nextGen,
  parseRenderMessages,
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
