import { SignJWT } from 'jose';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer, type ExecutorApp } from '@mwe/executor';
import { DEV_JWT_FALLBACK, DEV_JWT_SECRET_FALLBACK } from '@mwe/contracts/dev-auth';
import { startGraphql } from '../src/server.js';

let executor: ExecutorApp;
let graphqlUrl: string;
let stopGraphql: () => Promise<void>;

interface GqlResult {
  status: number;
  body: { data?: any; errors?: any };
}

async function gql(
  query: string,
  variables: Record<string, unknown> = {},
  token: string | null = DEV_JWT_FALLBACK,
): Promise<GqlResult> {
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  return { status: res.status, body: (await res.json()) as GqlResult['body'] };
}

beforeAll(async () => {
  executor = buildServer();
  await executor.app.listen({ port: 0, host: '127.0.0.1' });
  const executorUrl = `http://127.0.0.1:${executor.app.addresses()[0]!.port}`;
  const started = await startGraphql({ port: 0, executorUrl });
  graphqlUrl = started.url;
  stopGraphql = () => started.server.stop();
});

afterAll(async () => {
  await stopGraphql();
  await executor.app.close();
});

describe('graphql facade over the executor', () => {
  it('rejects requests without a valid bearer token', async () => {
    const { status, body } = await gql('{ tasks { id } }', {}, null);
    expect(status).toBe(401);
    expect(body.errors[0].extensions.code).toBe('UNAUTHENTICATED');

    const bad = await gql('{ tasks { id } }', {}, 'not-a-jwt');
    expect(bad.status).toBe(401);
  });

  it('round-trips createTask + tasks through the executor REST API', async () => {
    const created = await gql(
      'mutation ($title: String!) { createTask(title: $title) { id title due completed } }',
      { title: 'buy milk' },
    );
    expect(created.body.errors).toBeUndefined();
    expect(created.body.data.createTask).toEqual({
      id: 'task_0001',
      title: 'buy milk',
      due: null,
      completed: false,
    });

    const listed = await gql('{ tasks { id title completed } }');
    expect(listed.body.data.tasks).toHaveLength(1);

    // The executor audited the facade's calls under the verified user, with
    // the graphql.* tool names — the facade never touches the store directly.
    const audit = executor.audit.query({ userId: 'user-demo' });
    expect(audit.map((e) => e.tool)).toEqual(['graphql.createTask', 'graphql.tasks']);
    expect(audit[0]).toMatchObject({ decision: 'allowed', entityId: 'task_0001' });
  });

  it('completes a task and surfaces executor errors as GraphQL errors', async () => {
    const done = await gql('mutation ($id: ID!) { completeTask(id: $id) { id completed } }', {
      id: 'task_0001',
    });
    expect(done.body.data.completeTask).toEqual({ id: 'task_0001', completed: true });

    const missing = await gql('mutation ($id: ID!) { completeTask(id: $id) { id } }', {
      id: 'task_9999',
    });
    expect(missing.body.errors[0].message).toContain('404');
  });

  it('extracts the user from any validly-signed token', async () => {
    const secret = new TextEncoder().encode(DEV_JWT_SECRET_FALLBACK);
    const token = await new SignJWT({ email: 'other@example.com' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-other')
      .setIssuedAt()
      .setExpirationTime('1h')
      .sign(secret);

    await gql('mutation { createTask(title: "from other user") { id } }', {}, token);
    const audit = executor.audit.query({ userId: 'user-other' });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({ tool: 'graphql.createTask', userEmail: 'other@example.com' });
  });
});
