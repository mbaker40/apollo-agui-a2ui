import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildServer, type ExecutorApp } from '@mwe/executor';
import { DEV_JWT_FALLBACK } from '@mwe/contracts/dev-auth';
import { startGraphql } from '../src/server.js';

let executor: ExecutorApp;
let graphqlUrl: string;
let stopGraphql: () => Promise<void>;

async function gql(query: string, variables: Record<string, unknown> = {}) {
  const res = await fetch(graphqlUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${DEV_JWT_FALLBACK}`,
    },
    body: JSON.stringify({ query, variables }),
  });
  return (await res.json()) as { data?: any; errors?: any[] };
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

describe('graphql v2 operations round-trip through the executor', () => {
  it('walks the whole new surface in one scripted sequence', async () => {
    const created = await gql('mutation { createTask(title: "buy milk") { id priority tags { id } } }');
    expect(created.data.createTask).toEqual({ id: 'task_0001', priority: 'MEDIUM', tags: [] });

    const renamed = await gql(
      'mutation { renameTask(id: "task_0001", title: "buy oat milk") { title } }',
    );
    expect(renamed.data.renameTask.title).toBe('buy oat milk');

    const due = await gql('mutation { setDue(id: "task_0001", due: "2026-09-01") { due } }');
    expect(due.data.setDue.due).toBe('2026-09-01');

    const badDue = await gql('mutation { setDue(id: "task_0001", due: "2026-02-31") { due } }');
    expect(badDue.errors?.[0]?.message).toContain('400');

    const priority = await gql(
      'mutation { setPriority(id: "task_0001", priority: HIGH) { priority } }',
    );
    expect(priority.data.setPriority.priority).toBe('HIGH');

    const tagged = await gql(
      'mutation { tagTask(id: "task_0001", name: "errand") { tags { name } } }',
    );
    expect(tagged.data.tagTask.tags).toEqual([{ name: 'errand' }]);

    const dupTag = await gql('mutation { createTag(name: "ERRAND") { id } }');
    expect(dupTag.errors?.[0]?.message).toContain('409');

    const duplicated = await gql(
      'mutation { duplicateTask(id: "task_0001") { id title completed tags { name } } }',
    );
    expect(duplicated.data.duplicateTask).toEqual({
      id: 'task_0002',
      title: 'buy oat milk (copy)',
      completed: false,
      tags: [{ name: 'errand' }],
    });

    await gql('mutation { completeTask(id: "task_0002") { id } }');
    const reopened = await gql('mutation { reopenTask(id: "task_0002") { completed } }');
    expect(reopened.data.reopenTask.completed).toBe(false);

    await gql('mutation { completeTask(id: "task_0002") { id } }');
    const cleared = await gql('mutation { clearCompleted { id } }');
    expect(cleared.data.clearCompleted).toEqual([{ id: 'task_0002' }]);

    const deleted = await gql('mutation { deleteTask(id: "task_0001") { id title } }');
    expect(deleted.data.deleteTask).toEqual({ id: 'task_0001', title: 'buy oat milk' });

    const tags = await gql('{ tags { id name } }');
    expect(tags.data.tags).toEqual([{ id: 'tag_0001', name: 'errand' }]);

    const reset = await gql('mutation { resetDemo { deletedTaskIds deletedTagIds } }');
    expect(reset.data.resetDemo).toEqual({ deletedTaskIds: [], deletedTagIds: ['tag_0001'] });

    // Every operation went through the executor under its own graphql.* tool
    // name — the audit log is the proof the facade never touched the store.
    const tools = new Set(executor.audit.query().map((e) => e.tool));
    for (const tool of [
      'graphql.renameTask',
      'graphql.setDue',
      'graphql.setPriority',
      'graphql.reopenTask',
      'graphql.deleteTask',
      'graphql.duplicateTask',
      'graphql.clearCompleted',
      'graphql.createTag',
      'graphql.tagTask',
      'graphql.resetDemo',
      'graphql.tags',
    ]) {
      expect(tools, tool).toContain(tool);
    }
  });
});
