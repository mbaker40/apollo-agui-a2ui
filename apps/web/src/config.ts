import { DEV_JWT_FALLBACK } from '@mwe/contracts/dev-auth';

/**
 * All values have working local-dev defaults; override via Vite env vars
 * (see apps/web/README.md and /.env.example). The dev token can also be
 * swapped at runtime via localStorage key `dev_jwt` (e.g. one minted for a
 * different user with scripts/mint-dev-token.mjs).
 */
export const AGENT_URL: string = import.meta.env.VITE_AGENT_URL ?? 'http://localhost:7462/agui';
export const GRAPHQL_URL: string =
  import.meta.env.VITE_GRAPHQL_URL ?? 'http://localhost:7461/graphql';

function storedJwt(): string | null {
  try {
    return window.localStorage.getItem('dev_jwt');
  } catch {
    return null;
  }
}

export const DEV_JWT: string = storedJwt() ?? import.meta.env.VITE_DEV_JWT ?? DEV_JWT_FALLBACK;
