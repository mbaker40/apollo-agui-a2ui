import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DRAG_MIME, Glossary } from '../src/components/Glossary';
import { StoreProvider } from '../src/state/context';
import { createComposerStore } from '../src/state/store';

const USAGES = {
  Text: { usage: [{ id: 'root', component: 'Text', text: 'hi' }] },
  Button: {
    usage: [
      { id: 'root', component: 'Button', child: 'lbl' },
      { id: 'lbl', component: 'Text', text: 'Go' },
    ],
  },
  MysteryWidget: { usage: [{ id: 'root', component: 'MysteryWidget' }] },
};

function setup() {
  const store = createComposerStore();
  store.attachPort({
    sendRender: () => {},
    sendTheme: () => {},
    sendSetMode: () => {},
    sendSetSelection: () => {},
  });
  render(
    <StoreProvider store={store}>
      <Glossary />
    </StoreProvider>,
  );
  return store;
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('Glossary visual tiles', () => {
  it('renders a preview glyph + name per usage, with the description as tooltip', () => {
    const store = setup();
    expect(screen.queryByTestId('glossary-tile-Text')).toBeNull(); // usages not arrived
    act(() => store.actions.bridgeUsages(USAGES));

    const tile = screen.getByTestId('glossary-tile-Text');
    expect(tile.getAttribute('draggable')).toBe('true');
    expect(tile.textContent).toContain('Text');
    expect(screen.getByTestId('glossary-preview-Text')).toBeTruthy();
    // description moved to the title tooltip, plus the derived insert target
    expect(tile.getAttribute('title')).toContain('Styled text');
    expect(tile.getAttribute('title')).toContain('#root');
  });

  it('falls back to a generic glyph for unknown component names (BYO catalogs)', () => {
    const store = setup();
    act(() => store.actions.bridgeUsages(USAGES));
    const preview = screen.getByTestId('glossary-preview-MysteryWidget');
    expect(preview.className).toContain('gp-fallback');
    const known = screen.getByTestId('glossary-preview-Button');
    expect(known.className).not.toContain('gp-fallback');
  });

  it('click inserts into the container derived from the selection', () => {
    const store = setup();
    act(() => store.actions.bridgeUsages(USAGES));
    // Build: root ← Button(child lbl). Selecting the Button's label targets root.
    fireEvent.click(screen.getByTestId('glossary-tile-Button'));
    expect(store.getState().doc.components.some((c) => c.id === 'root-g1')).toBe(true);
    act(() => store.actions.selectComponent('lbl-g1'));
    // hint reflects the derived target (root — nearest children-array ancestor)
    expect(screen.getByTestId('glossary-tile-Text').getAttribute('title')).toContain('#root');
    fireEvent.click(screen.getByTestId('glossary-tile-Text'));
    const root = store.getState().doc.components.find((c) => c.id === 'root')!;
    expect(root.children).toContain('root-g2');
  });

  it('dragstart writes the drag data and uses the preview as the drag image', () => {
    const store = setup();
    act(() => store.actions.bridgeUsages(USAGES));
    const setData = vi.fn();
    const setDragImage = vi.fn();
    fireEvent.dragStart(screen.getByTestId('glossary-tile-Button'), {
      dataTransfer: { setData, setDragImage, effectAllowed: '' },
    });
    expect(setData).toHaveBeenCalledWith(DRAG_MIME, 'Button');
    expect(setDragImage).toHaveBeenCalledTimes(1);
    const [el] = setDragImage.mock.calls[0] as [HTMLElement];
    expect(el.dataset.testid).toBe('glossary-preview-Button');
    expect(store.getState().dragging).toBe(true);
    fireEvent.dragEnd(screen.getByTestId('glossary-tile-Button'));
    expect(store.getState().dragging).toBe(false);
  });

  it('survives environments without setDragImage (jsdom guard)', () => {
    const store = setup();
    act(() => store.actions.bridgeUsages(USAGES));
    const setData = vi.fn();
    fireEvent.dragStart(screen.getByTestId('glossary-tile-Text'), {
      dataTransfer: { setData, effectAllowed: '' }, // no setDragImage at all
    });
    expect(setData).toHaveBeenCalledWith(DRAG_MIME, 'Text');
    expect(store.getState().dragging).toBe(true);
  });
});
