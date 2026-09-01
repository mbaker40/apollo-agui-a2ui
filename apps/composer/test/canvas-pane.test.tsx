import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { CanvasPane } from '../src/components/CanvasPane';
import { StoreProvider } from '../src/state/context';
import { createComposerStore } from '../src/state/store';

function setup() {
  const store = createComposerStore();
  render(
    <StoreProvider store={store}>
      <CanvasPane />
    </StoreProvider>,
  );
  return store;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('mode toggle', () => {
  it('renders the Edit | Preview segmented control, Edit active by default', () => {
    const store = setup();
    const edit = screen.getByTestId('mode-edit');
    const preview = screen.getByTestId('mode-preview');
    expect(edit.getAttribute('title')).toBe('Edit mode');
    expect(preview.getAttribute('title')).toBe('Preview mode');
    expect(edit.getAttribute('aria-pressed')).toBe('true');
    expect(preview.getAttribute('aria-pressed')).toBe('false');
    expect(store.getState().mode).toBe('edit');

    fireEvent.click(preview);
    expect(store.getState().mode).toBe('preview');
    expect(screen.getByTestId('mode-preview').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(screen.getByTestId('mode-edit'));
    expect(store.getState().mode).toBe('edit');
  });
});

describe('layout tree selection', () => {
  it('makes every node clickable, sharing the unified selection', () => {
    const store = setup();
    const leaf = screen.getByTestId('tree-node-welcome-title');
    expect(leaf.className).toContain('leaf');
    fireEvent.click(leaf);
    expect(store.getState().selectedComponentId).toBe('welcome-title');
    expect(screen.getByTestId('tree-node-welcome-title').className).toContain('selected');

    const container = screen.getByTestId('tree-node-root');
    expect(container.className).toContain('container');
    fireEvent.click(container);
    expect(store.getState().selectedComponentId).toBe('root');
  });
});

describe('structural drop fallback', () => {
  it('shows the derived insert target in the drop hint when no DnD sidecar exists', () => {
    const store = setup();
    act(() => store.actions.setDragging(true));
    expect(screen.getByTestId('drop-overlay').textContent).toContain('Drop to insert into #root');
    act(() => store.actions.selectComponent('welcome-body')); // a Column container
    expect(screen.getByTestId('drop-overlay').textContent).toContain(
      'Drop to insert into #welcome-body',
    );
    act(() => store.actions.selectComponent('welcome-title')); // leaf → containing Column
    expect(screen.getByTestId('drop-overlay').textContent).toContain(
      'Drop to insert into #welcome-body',
    );
  });

  it('mentions the highlighted position when the sidecar announces dnd-hittest', () => {
    const store = setup();
    act(() => {
      store.actions.bridgeSidecarReady({
        features: ['dnd-hittest', 'select', 'prop-specs'],
        version: 2,
      });
      store.actions.setDragging(true);
    });
    expect(screen.getByTestId('drop-overlay').textContent).toContain('highlighted position');
  });

  it('drops into the container derived from the selection', () => {
    const store = setup();
    act(() => {
      store.actions.bridgeUsages({
        Text: { usage: [{ id: 'root', component: 'Text', text: 'x' }] },
      });
      store.actions.selectComponent('welcome-title'); // leaf inside welcome-body
      store.actions.setDragging(true);
    });
    fireEvent.drop(screen.getByTestId('drop-overlay'), {
      dataTransfer: { getData: () => 'Text' },
    });
    const body = store.getState().doc.components.find((c) => c.id === 'welcome-body')!;
    expect(body.children).toContain('root-g1');
    expect(store.getState().dragging).toBe(false);
  });
});
