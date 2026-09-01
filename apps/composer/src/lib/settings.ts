/** Persisted settings (contract §7 storage keys) + renderer URL resolution (§9). */

export const STORAGE_KEYS = {
  rendererUrl: 'composerx.rendererUrl',
  apiKey: 'composerx.apiKey',
  model: 'composerx.model',
  theme: 'composerx.theme',
  mockLlm: 'composerx.mockLlm',
} as const;

export type Theme = 'light' | 'dark';

export const MODELS: readonly { id: string; label: string }[] = [
  { id: 'claude-opus-5', label: 'Opus 5' },
  { id: 'claude-sonnet-5', label: 'Sonnet 5' },
  { id: 'claude-haiku-4-5-20251001', label: 'Haiku 4.5' },
];

export const DEFAULT_MODEL = 'claude-opus-5';

export function readSetting(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeSetting(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private mode, sandbox) — settings just don't persist.
  }
}

export interface EnvLike {
  DEV?: boolean;
  VITE_RENDERER_URL?: string;
}

/** Renderer URL default chain minus localStorage (contract §9). */
export function defaultRendererUrl(env: EnvLike = import.meta.env): string {
  if (env.VITE_RENDERER_URL) return env.VITE_RENDERER_URL;
  if (env.DEV) return 'http://localhost:7465/';
  return new URL('catalog/', document.baseURI).href;
}

/** Full §9 chain: localStorage → VITE_RENDERER_URL → dev localhost:7465 → ./catalog/. */
export function resolveRendererUrl(env: EnvLike = import.meta.env): string {
  const stored = readSetting(STORAGE_KEYS.rendererUrl);
  if (stored) return stored;
  return defaultRendererUrl(env);
}

export function loadTheme(): Theme {
  return readSetting(STORAGE_KEYS.theme) === 'dark' ? 'dark' : 'light';
}

/** The shell's own theme rides `data-theme` on <html> (set pre-mount in index.html). */
export function applyShellTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
}

/** Iframe URL contract (§2): renderer URL + `?origin=` + `&theme=`. */
export function buildIframeSrc(rendererUrl: string, theme: Theme): string {
  const url = new URL(rendererUrl, window.location.href);
  url.searchParams.set('origin', window.location.origin);
  url.searchParams.set('theme', theme);
  return url.href;
}

export function rendererOrigin(rendererUrl: string): string {
  return new URL(rendererUrl, window.location.href).origin;
}
