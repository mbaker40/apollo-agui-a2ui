/**
 * DEV-ONLY auth defaults shared by the web app, e2e suite, and service tests.
 * Not a protocol contract — a convenience so clone-and-run needs zero setup.
 * The secret is intentionally public; see scripts/mint-dev-token.mjs.
 */

export const DEV_JWT_SECRET_FALLBACK = 'dev-secret-not-for-production-32b-min!';

/** Long-lived token for sub=user-demo, minted by scripts/mint-dev-token.mjs. */
export const DEV_JWT_FALLBACK =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLWRlbW8iLCJlbWFpbCI6ImRlbW9AZXhhbXBsZS5jb20iLCJuYW1lIjoiRGVtbyBVc2VyIiwiaWF0IjoxNzg3OTc4MjkzLCJleHAiOjIxMDMzMzgyOTN9.isX6kh2a1JReimbCgD9Dy5meEIpkaqnmtsr-_79_oFc';

export const DEV_USER = {
  sub: 'user-demo',
  email: 'demo@example.com',
  name: 'Demo User',
} as const;
