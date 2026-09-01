/**
 * Mobile breakpoint (contract §7b): ≤900px switches the shell to the
 * single-column layout with the bottom tab bar. This constant is the one
 * source of truth on the JS side; the CSS media queries in styles.css use
 * the same 900px literal (CSS cannot read TS — keep them in sync, both
 * sides carry a pointer at the other).
 */
export const MOBILE_BREAKPOINT_PX = 900;
export const MOBILE_MEDIA_QUERY = `(max-width: ${MOBILE_BREAKPOINT_PX}px)`;

/**
 * One-shot breakpoint check for store initialization. Safe where matchMedia
 * is missing or throws (jsdom, sandboxed frames): defaults to desktop.
 */
export function matchMobile(): boolean {
  try {
    return window.matchMedia?.(MOBILE_MEDIA_QUERY).matches ?? false;
  } catch {
    return false;
  }
}

/**
 * Subscribes to breakpoint crossings (viewport resize / rotation) and
 * returns an unsubscribe function. No-op unsubscribe when matchMedia is
 * unavailable.
 */
export function watchMobile(onChange: (mobile: boolean) => void): () => void {
  let mql: MediaQueryList | undefined;
  try {
    mql = window.matchMedia?.(MOBILE_MEDIA_QUERY);
  } catch {
    mql = undefined;
  }
  if (!mql) return () => {};
  const list = mql;
  const handler = () => onChange(list.matches);
  list.addEventListener('change', handler);
  return () => list.removeEventListener('change', handler);
}
