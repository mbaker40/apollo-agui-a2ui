#!/usr/bin/env node
/**
 * Mints a DEV-ONLY HS256 JWT for the demo stack. The signing secret is a
 * well-known string checked into this repo — this is deliberately NOT secure,
 * it only demonstrates the *shape* of real auth (bearer token verified by the
 * agent + GraphQL facade, identity forwarded to the executor as headers).
 *
 * Usage: node scripts/mint-dev-token.mjs [sub] [email] [name]
 */
import crypto from 'node:crypto';

const b64url = (input) => Buffer.from(input).toString('base64url');

const secret = process.env.DEV_JWT_SECRET ?? 'dev-secret-not-for-production';
const sub = process.argv[2] ?? 'user-demo';
const email = process.argv[3] ?? 'demo@example.com';
const name = process.argv[4] ?? 'Demo User';

const now = Math.floor(Date.now() / 1000);
const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
const payload = b64url(
  JSON.stringify({ sub, email, name, iat: now, exp: now + 10 * 365 * 24 * 3600 }),
);
const signature = b64url(
  crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest(),
);

console.log(`${header}.${payload}.${signature}`);
