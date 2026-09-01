/**
 * Breakpoint detection (contract §7b): matchMobile/watchMobile wrap
 * window.matchMedia (stubbed desktop-width in test/setup.ts, overridden
 * here per test) and createComposerStore consults matchMobile unless the
 * injectable `mobile` option says otherwise.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  MOBILE_BREAKPOINT_PX,
  MOBILE_MEDIA_QUERY,
  matchMobile,
  watchMobile,
} from '../src/lib/viewport';
import { createComposerStore } from '../src/state/store';

const originalMatchMedia = window.matchMedia;

function stubMatchMedia(mql: Partial<MediaQueryList> & { matches: boolean }) {
  const seen: string[] = [];
  window.matchMedia = ((query: string) => {
    seen.push(query);
    return {
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
      ...mql,
    } as MediaQueryList;
  }) as typeof window.matchMedia;
  return seen;
}

afterEach(() => {
  window.matchMedia = originalMatchMedia;
});

describe('viewport breakpoint', () => {
  it('uses one 900px query constant', () => {
    expect(MOBILE_MEDIA_QUERY).toBe(`(max-width: ${MOBILE_BREAKPOINT_PX}px)`);
    expect(MOBILE_BREAKPOINT_PX).toBe(900);
  });

  it('matchMobile reflects the media query (and defaults desktop without matchMedia)', () => {
    const seen = stubMatchMedia({ matches: true });
    expect(matchMobile()).toBe(true);
    expect(seen).toEqual([MOBILE_MEDIA_QUERY]);
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    expect(matchMobile()).toBe(false);
  });

  it('createComposerStore consults matchMedia when no override is given', () => {
    stubMatchMedia({ matches: true });
    const store = createComposerStore();
    expect(store.getState().mobile).toBe(true);
    expect(store.getState().drawerOpen).toBe(false); // §7b: drawer closed on mobile
    const overridden = createComposerStore({ mobile: false });
    expect(overridden.getState().mobile).toBe(false);
  });

  it('watchMobile forwards change events and unsubscribes cleanly', () => {
    let listener: (() => void) | null = null;
    const removeEventListener = vi.fn();
    // The live object itself is returned so mutating `matches` is observable.
    const mql = {
      matches: false,
      media: MOBILE_MEDIA_QUERY,
      addEventListener: (_type: string, fn: () => void) => {
        listener = fn;
      },
      removeEventListener,
    };
    window.matchMedia = (() => mql) as unknown as typeof window.matchMedia;
    const seen: boolean[] = [];
    const stop = watchMobile((mobile) => seen.push(mobile));
    mql.matches = true;
    listener!();
    mql.matches = false;
    listener!();
    expect(seen).toEqual([true, false]);
    stop();
    expect(removeEventListener).toHaveBeenCalledTimes(1);
  });

  it('watchMobile is a no-op without matchMedia', () => {
    (window as { matchMedia?: unknown }).matchMedia = undefined;
    const stop = watchMobile(() => {});
    expect(() => stop()).not.toThrow();
  });
});
