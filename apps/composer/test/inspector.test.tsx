import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Inspector } from '../src/components/Inspector';
import type { PropSpecsPayload } from '../src/lib/bridge-host';
import type { SurfaceDoc } from '../src/lib/surface-doc';
import { CATALOG_ID, SURFACE_ID } from '../src/lib/surface-doc';
import { StoreProvider } from '../src/state/context';
import { createComposerStore } from '../src/state/store';

function fixtureDoc(): SurfaceDoc {
  return {
    surfaceId: SURFACE_ID,
    catalogId: CATALOG_ID,
    components: [
      { id: 'root', component: 'Column', children: ['card', 'txt', 'boundTxt', 'chk'] },
      { id: 'card', component: 'Card', child: 'cardBody' },
      { id: 'cardBody', component: 'Column', children: [] },
      { id: 'txt', component: 'Text', text: 'hello', extra: { a: 1 } },
      { id: 'boundTxt', component: 'Text', text: { path: '/msg' } },
      { id: 'chk', component: 'CheckBox', label: 'ok', value: false },
    ],
    dataModel: {},
  };
}

const SPECS: PropSpecsPayload = {
  components: {
    Text: {
      props: [
        { name: 'text', kind: 'string', required: true, bindable: true },
        { name: 'variant', kind: 'enum', options: ['h1', 'h2', 'body'] },
        { name: 'maxLines', kind: 'number' },
        { name: 'selectable', kind: 'boolean' },
        { name: 'style', kind: 'json' },
      ],
    },
    Card: { props: [{ name: 'child', kind: 'string', required: true, containment: true }] },
    Column: {
      props: [
        { name: 'children', kind: 'json', containment: true },
        { name: 'justify', kind: 'enum', options: ['start', 'center', 'end'] },
      ],
    },
    CheckBox: {
      props: [
        { name: 'label', kind: 'string', required: true, bindable: true },
        { name: 'value', kind: 'boolean', bindable: true },
      ],
    },
  },
};

function setup({ specs = true }: { specs?: boolean } = {}) {
  const store = createComposerStore({ doc: fixtureDoc() });
  store.attachPort({
    sendRender: () => {},
    sendTheme: () => {},
    sendSetMode: () => {},
    sendSetSelection: () => {},
  });
  if (specs) store.actions.bridgePropSpecs(SPECS);
  render(
    <StoreProvider store={store}>
      <Inspector />
    </StoreProvider>,
  );
  return { store };
}

function component(store: ReturnType<typeof createComposerStore>, id: string) {
  const found = store.getState().doc.components.find((c) => c.id === id);
  if (!found) throw new Error(`component ${id} missing`);
  return found;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('Inspector empty state', () => {
  it('hints at selecting when nothing is selected', () => {
    setup();
    expect(screen.getByTestId('inspector')).toBeTruthy();
    expect(screen.getByTestId('inspector-empty').textContent).toMatch(
      /Click a component on the canvas or in the tree/,
    );
  });
});

describe('Inspector spec-driven form', () => {
  it('renders one widget per spec kind with the current values', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('txt'));
    expect(screen.getByTestId('inspector').textContent).toContain('Text');
    expect(screen.getByTestId('inspector').textContent).toContain('#txt');

    const text = screen.getByTestId('prop-text') as HTMLInputElement;
    expect(text.tagName).toBe('INPUT');
    expect(text.type).toBe('text');
    expect(text.value).toBe('hello');

    const variant = screen.getByTestId('prop-variant') as HTMLSelectElement;
    expect(variant.tagName).toBe('SELECT');
    expect([...variant.options].map((o) => o.value)).toEqual(['', 'h1', 'h2', 'body']);

    const maxLines = screen.getByTestId('prop-maxLines') as HTMLInputElement;
    expect(maxLines.type).toBe('number');

    const selectable = screen.getByTestId('prop-selectable') as HTMLInputElement;
    expect(selectable.type).toBe('checkbox');
    expect(selectable.checked).toBe(false);

    const style = screen.getByTestId('prop-style') as HTMLTextAreaElement;
    expect(style.tagName).toBe('TEXTAREA');

    // required marker on text, and no remove affordance for it
    expect(screen.getByTitle('Required prop')).toBeTruthy();
    expect(screen.queryByTestId('prop-text-remove')).toBeNull();
    // optional + absent props have no remove either
    expect(screen.queryByTestId('prop-variant-remove')).toBeNull();
  });

  it('commits text on blur (once) and on Enter — one undo step per commit', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('txt'));
    const text = screen.getByTestId('prop-text') as HTMLInputElement;
    fireEvent.change(text, { target: { value: 'world' } });
    fireEvent.blur(text);
    expect(component(store, 'txt').text).toBe('world');
    expect(store.getState().undoStack).toHaveLength(1);

    // blurring again without changes adds no undo step
    const again = screen.getByTestId('prop-text') as HTMLInputElement;
    fireEvent.blur(again);
    expect(store.getState().undoStack).toHaveLength(1);

    const enter = screen.getByTestId('prop-text') as HTMLInputElement;
    fireEvent.change(enter, { target: { value: 'enter!' } });
    fireEvent.keyDown(enter, { key: 'Enter' });
    expect(component(store, 'txt').text).toBe('enter!');
    expect(store.getState().undoStack).toHaveLength(2);
  });

  it('commits enums and checkboxes immediately; ✕ removes optional present props', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('txt'));
    fireEvent.change(screen.getByTestId('prop-variant'), { target: { value: 'h2' } });
    expect(component(store, 'txt').variant).toBe('h2');
    expect(store.getState().undoStack).toHaveLength(1);

    // present now → remove affordance appears
    fireEvent.click(screen.getByTestId('prop-variant-remove'));
    expect('variant' in component(store, 'txt')).toBe(false);
    expect(store.getState().undoStack).toHaveLength(2);

    fireEvent.click(screen.getByTestId('prop-selectable'));
    expect(component(store, 'txt').selectable).toBe(true);
    expect(store.getState().undoStack).toHaveLength(3);
  });

  it('commits numbers as numbers on blur', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('txt'));
    const maxLines = screen.getByTestId('prop-maxLines') as HTMLInputElement;
    fireEvent.change(maxLines, { target: { value: '3' } });
    fireEvent.blur(maxLines);
    expect(component(store, 'txt').maxLines).toBe(3);
  });

  it('validates JSON on commit and shows the error inline', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('txt'));
    const style = screen.getByTestId('prop-style') as HTMLTextAreaElement;
    fireEvent.change(style, { target: { value: '{bad json' } });
    fireEvent.blur(style);
    expect(screen.getByTestId('prop-style-error')).toBeTruthy();
    expect('style' in component(store, 'txt')).toBe(false);
    expect(store.getState().undoStack).toHaveLength(0);

    fireEvent.change(style, { target: { value: '{"color": "red"}' } });
    fireEvent.blur(style);
    expect(component(store, 'txt').style).toEqual({ color: 'red' });
    expect(screen.queryByTestId('prop-style-error')).toBeNull();
  });

  it('shows unspec’d instance props in the Advanced JSON section', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('txt'));
    expect(screen.getByTestId('inspector-advanced')).toBeTruthy();
    const extra = screen.getByTestId('prop-extra') as HTMLTextAreaElement;
    expect(extra.tagName).toBe('TEXTAREA');
    fireEvent.change(extra, { target: { value: '{"a": 2}' } });
    fireEvent.blur(extra);
    expect(component(store, 'txt').extra).toEqual({ a: 2 });
  });
});

describe('Inspector bind toggle', () => {
  it('initializes bound from a {path} value and edits the path', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('boundTxt'));
    const toggle = screen.getByTestId('prop-text-bind');
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    const path = screen.getByTestId('prop-text') as HTMLInputElement;
    expect(path.value).toBe('/msg');
    fireEvent.change(path, { target: { value: '/other' } });
    fireEvent.blur(path);
    expect(component(store, 'boundTxt').text).toEqual({ path: '/other' });
  });

  it('unbinding switches back to the literal widget', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('boundTxt'));
    fireEvent.click(screen.getByTestId('prop-text-bind'));
    const text = screen.getByTestId('prop-text') as HTMLInputElement;
    expect(text.type).toBe('text');
    fireEvent.change(text, { target: { value: 'plain again' } });
    fireEvent.blur(text);
    expect(component(store, 'boundTxt').text).toBe('plain again');
    // re-seeded row is now unbound
    expect(screen.getByTestId('prop-text-bind').getAttribute('aria-pressed')).toBe('false');
  });

  it('binding a literal prop commits a {path} value', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('txt'));
    expect(screen.getByTestId('prop-text-bind').getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(screen.getByTestId('prop-text-bind'));
    const path = screen.getByTestId('prop-text') as HTMLInputElement;
    fireEvent.change(path, { target: { value: '/user/name' } });
    fireEvent.keyDown(path, { key: 'Enter' });
    expect(component(store, 'txt').text).toEqual({ path: '/user/name' });
  });
});

describe('Inspector containment + delete', () => {
  it('shows containment props as read-only values', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('card'));
    const child = screen.getByTestId('prop-child');
    expect(child.tagName).toBe('CODE');
    expect(child.textContent).toBe('"cardBody"');
    expect(screen.queryByTestId('prop-child-remove')).toBeNull();
  });

  it('disables Delete for root and single-slot occupants, with the §5 hint', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('root'));
    expect((screen.getByTestId('inspector-delete') as HTMLButtonElement).disabled).toBe(true);

    act(() => store.actions.selectComponent('cardBody')); // Card child slot
    const del = screen.getByTestId('inspector-delete') as HTMLButtonElement;
    expect(del.disabled).toBe(true);
    expect(screen.getByTestId('inspector-delete-hint').textContent).toMatch(
      /single slot of #card.*delete the parent, or edit via JSON/i,
    );
  });

  it('Delete removes an eligible component and empties the inspector', () => {
    const { store } = setup();
    act(() => store.actions.selectComponent('card'));
    const del = screen.getByTestId('inspector-delete') as HTMLButtonElement;
    expect(del.disabled).toBe(false);
    fireEvent.click(del);
    const ids = store.getState().doc.components.map((c) => c.id);
    expect(ids).not.toContain('card');
    expect(ids).not.toContain('cardBody');
    expect(store.getState().selectedComponentId).toBeNull();
    expect(screen.getByTestId('inspector-empty')).toBeTruthy();
  });
});

describe('Inspector no-specs fallback', () => {
  it('falls back to generic JSON rows plus an add-prop row', () => {
    const { store } = setup({ specs: false });
    act(() => store.actions.selectComponent('txt'));
    expect(screen.getByTestId('inspector-fallback')).toBeTruthy();
    const text = screen.getByTestId('prop-text') as HTMLTextAreaElement;
    expect(text.tagName).toBe('TEXTAREA');
    expect(text.value).toBe('"hello"');
    fireEvent.change(text, { target: { value: '"bye"' } });
    fireEvent.blur(text);
    expect(component(store, 'txt').text).toBe('bye');

    // add prop: JSON values parse, non-JSON text commits as a string
    fireEvent.change(screen.getByTestId('prop-add-name'), { target: { value: 'meta' } });
    fireEvent.change(screen.getByTestId('prop-add-value'), { target: { value: '{"a": 1}' } });
    fireEvent.click(screen.getByTestId('prop-add'));
    expect(component(store, 'txt').meta).toEqual({ a: 1 });

    fireEvent.change(screen.getByTestId('prop-add-name'), { target: { value: 'note' } });
    fireEvent.change(screen.getByTestId('prop-add-value'), { target: { value: 'plain words' } });
    fireEvent.click(screen.getByTestId('prop-add'));
    expect(component(store, 'txt').note).toBe('plain words');
  });

  it('guards structural keys in the fallback (containment rows + add-prop errors)', () => {
    const { store } = setup({ specs: false });
    act(() => store.actions.selectComponent('card'));
    // `child` renders read-only, not editable
    expect(screen.getByTestId('prop-child').tagName).toBe('CODE');

    fireEvent.change(screen.getByTestId('prop-add-name'), { target: { value: 'children' } });
    fireEvent.change(screen.getByTestId('prop-add-value'), { target: { value: '[]' } });
    fireEvent.click(screen.getByTestId('prop-add'));
    expect(screen.getByTestId('prop-add-error').textContent).toMatch(/cannot be edited directly/);
    expect('children' in component(store, 'card')).toBe(false);
  });
});
