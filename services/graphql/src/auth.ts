import { jwtVerify } from 'jose';

export interface AuthedUser {
  sub: string;
  email?: string;
  name?: string;
}

const secret = () =>
  new TextEncoder().encode(process.env.DEV_JWT_SECRET ?? 'dev-secret-not-for-production-32b-min!');

/**
 * Demo-grade but real in shape: the facade verifies the end user's bearer
 * token itself (HS256 with a well-known dev secret) and forwards only verified
 * identity to the executor. Returns null for missing/invalid tokens.
 */
export async function verifyBearer(authorization: string | undefined): Promise<AuthedUser | null> {
  if (!authorization?.startsWith('Bearer ')) return null;
  try {
    const { payload } = await jwtVerify(authorization.slice('Bearer '.length), secret(), {
      algorithms: ['HS256'],
    });
    if (typeof payload.sub !== 'string') return null;
    return {
      sub: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : undefined,
      name: typeof payload.name === 'string' ? payload.name : undefined,
    };
  } catch {
    return null;
  }
}
