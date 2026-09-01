/**
 * App-level mobile layout (contract §7b): the bottom tab bar switches the
 * mobile-view-* class, the renderer iframe stays MOUNTED (same DOM node)
 * across every view switch, and the toast renders with its testid.
 */
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import App from '../src/App';
import { StoreProvider } from '../src/state/context';
import { createComposerStore } from '../src/state/store';

function setup(mobile = true) {
  const store = createComposerStore({ mobile });
  const { container } = render(
    <StoreProvider store={store}>
      <App />
    </StoreProvider>,
  );
  const app = container.querySelector('.app')!;
  return { store, app };
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('mobile tab bar', () => {
  it('renders the four view tabs with Canvas active by default', () => {
    setup();
    for (const id of ['canvas', 'add', 'design', 'chat']) {
      expect(screen.getByTestId(`mtab-${id}`)).toBeTruthy();
    }
    const canvasTab = screen.getByTestId('mtab-canvas');
    expect(canvasTab.className).toContain('active');
    expect(canvasTab.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('mtab-add').getAttribute('aria-pressed')).toBe('false');
  });

  it('switches the app view class and the active tab on tap', () => {
    const { store, app } = setup();
    expect(app.className).toContain('mobile-view-canvas');
    fireEvent.click(screen.getByTestId('mtab-add'));
    expect(store.getState().mobileView).toBe('add');
    expect(app.className).toContain('mobile-view-add');
    expect(screen.getByTestId('mtab-add').className).toContain('active');
    fireEvent.click(screen.getByTestId('mtab-chat'));
    expect(app.className).toContain('mobile-view-chat');
    expect(store.getState().rightTab).toBe('chat'); // sidebar body follows
    fireEvent.click(screen.getByTestId('mtab-design'));
    expect(store.getState().rightTab).toBe('design');
  });

  it('keeps the renderer iframe mounted (same DOM node) across every view switch', () => {
    const { app } = setup();
    const iframe = app.querySelector('.renderer-iframe');
    expect(iframe).toBeTruthy();
    for (const id of ['add', 'design', 'chat', 'canvas', 'add', 'canvas']) {
      fireEvent.click(screen.getByTestId(`mtab-${id}`));
      const now = app.querySelector('.renderer-iframe');
      expect(now).toBe(iframe); // identity: a remount would create a new node
    }
  });

  it('selecting a component switches the mobile app to the Design view', () => {
    const { store, app } = setup();
    act(() => store.actions.selectComponent('welcome-card'));
    expect(app.className).toContain('mobile-view-design');
    expect(store.getState().rightTab).toBe('design');
  });
});

describe('mobile toast', () => {
  it('renders with the mtoast testid and dismisses on tap', () => {
    const { store } = setup();
    expect(screen.queryByTestId('mtoast')).toBeNull();
    act(() => store.actions.showToast('Button → #root'));
    const toast = screen.getByTestId('mtoast');
    expect(toast.textContent).toBe('Button → #root');
    fireEvent.click(toast);
    expect(screen.queryByTestId('mtoast')).toBeNull();
    act(() => store.actions.dismissToast()); // idempotent
  });
});

describe('desktop shell', () => {
  it('still renders the three panes plus the (CSS-hidden) tab bar', () => {
    const { store, app } = setup(false);
    expect(app.querySelector('.glossary')).toBeTruthy();
    expect(app.querySelector('.canvas-pane')).toBeTruthy();
    expect(app.querySelector('.sidebar')).toBeTruthy();
    expect(app.querySelector('.mobile-tabbar')).toBeTruthy();
    expect(store.getState().drawerOpen).toBe(true); // desktop default unchanged
  });
});
