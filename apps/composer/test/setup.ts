/**
 * Shared vitest setup. jsdom has no window.matchMedia, which the app now
 * consults for the ≤900px mobile breakpoint (src/lib/viewport.ts): stub a
 * desktop-width default (matches: false) so components render the desktop
 * layout unless a test opts in. Tests that need mobile behavior pass
 * `{ mobile: true }` to createComposerStore instead of faking media queries.
 */
if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  const stub = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    configurable: true,
    value: stub,
  });
}

export {};
