import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type ExecutorApp } from '../src/server.js';

function headers(tool: string) {
  return {
    'x-caller-service': 'agent',
    'x-user-id': 'user-demo',
    'x-agent-run-id': 'run-v2',
    'x-tool-name': tool,
  };
}

describe('executor v2 operations', () => {
  let ctx: ExecutorApp;

  beforeEach(async () => {
    ctx = buildServer();
    await ctx.app.inject({
      method: 'POST',
      url: '/tasks',
      headers: headers('create_task'),
      payload: { title: 'buy milk' },
    });
  });

  it('renames a task', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/rename',
      headers: headers('rename_task'),
      payload: { title: 'buy oat milk' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'task_0001', title: 'buy oat milk' });
  });

  it('sets, validates, and clears due dates', async () => {
    const ok = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/due',
      headers: headers('set_due'),
      payload: { due: '2026-09-01' },
    });
    expect(ok.json()).toMatchObject({ due: '2026-09-01' });

    for (const bad of ['tomorrow', '2026-13-45', '2026-02-31', '09/01/2026']) {
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/tasks/task_0001/due',
        headers: headers('set_due'),
        payload: { due: bad },
      });
      expect(res.statusCode, bad).toBe(400);
      expect(res.json().error).toContain('not a valid ISO date');
    }

    const cleared = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/due',
      headers: headers('set_due'),
      payload: { due: null },
    });
    expect(cleared.json()).toMatchObject({ due: null });
  });

  it('sets priority and rejects unknown levels', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/priority',
      headers: headers('set_priority'),
      payload: { priority: 'HIGH' },
    });
    expect(res.json()).toMatchObject({ priority: 'HIGH' });

    const bad = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/priority',
      headers: headers('set_priority'),
      payload: { priority: 'CRITICAL' },
    });
    expect(bad.statusCode).toBe(400);
  });

  it('reopens a completed task', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/complete',
      headers: headers('complete_task'),
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/reopen',
      headers: headers('reopen_task'),
    });
    expect(res.json()).toMatchObject({ id: 'task_0001', completed: false });
  });

  it('deletes a task (returning it) and 404s on a missing one', async () => {
    const res = await ctx.app.inject({
      method: 'DELETE',
      url: '/tasks/task_0001',
      headers: headers('delete_task'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ id: 'task_0001', title: 'buy milk' });

    const missing = await ctx.app.inject({
      method: 'DELETE',
      url: '/tasks/task_0001',
      headers: headers('delete_task'),
    });
    expect(missing.statusCode).toBe(404);
  });

  it('duplicates a task as a fresh uncompleted copy', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/complete',
      headers: headers('complete_task'),
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/duplicate',
      headers: headers('duplicate_task'),
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({
      id: 'task_0002',
      title: 'buy milk (copy)',
      completed: false,
    });
  });

  it('clears completed tasks in bulk (and audits the batch of entity ids)', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/tasks',
      headers: headers('create_task'),
      payload: { title: 'call the vet' },
    });
    for (const id of ['task_0001', 'task_0002']) {
      await ctx.app.inject({
        method: 'POST',
        url: `/tasks/${id}/complete`,
        headers: headers('complete_task'),
      });
    }

    const res = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/completed/clear',
      headers: headers('clear_completed'),
    });
    expect(res.json().deleted.map((t: { id: string }) => t.id)).toEqual([
      'task_0001',
      'task_0002',
    ]);

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/tasks',
      headers: headers('list_tasks'),
    });
    expect(list.json()).toEqual([]);

    const entry = ctx.audit.query().find((e) => e.tool === 'clear_completed');
    expect(entry?.entityId).toBe('task_0001,task_0002');

    // Nothing-to-clear edge: an empty batch, no audit entity ids.
    const again = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/completed/clear',
      headers: headers('clear_completed'),
    });
    expect(again.json()).toEqual({ deleted: [] });
  });

  it("routes 'completed' as a static segment, never as a task id", async () => {
    // If :id captured 'completed', the allowlist (clear_completed → its own
    // route) would 403 this request.
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/completed/clear',
      headers: headers('clear_completed'),
    });
    expect(res.statusCode).toBe(200);
  });

  it('creates tags and 409s duplicates case-insensitively', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/tags',
      headers: headers('create_tag'),
      payload: { name: 'urgent' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ id: 'tag_0001', name: 'urgent' });

    const dup = await ctx.app.inject({
      method: 'POST',
      url: '/tags',
      headers: headers('create_tag'),
      payload: { name: 'URGENT' },
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error).toContain('already exists');
  });

  it('tags a task, auto-creating the tag, idempotently, and embeds tags in reads', async () => {
    const first = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/tags',
      headers: headers('tag_task'),
      payload: { name: 'errand' },
    });
    expect(first.json()).toMatchObject({
      tagCreated: true,
      tag: { id: 'tag_0001', name: 'errand' },
      task: { id: 'task_0001', tags: [{ id: 'tag_0001', name: 'errand' }] },
    });

    const second = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/tags',
      headers: headers('tag_task'),
      payload: { name: 'Errand' },
    });
    expect(second.json().tagCreated).toBe(false);
    expect(second.json().task.tags).toHaveLength(1);

    const missing = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_9999/tags',
      headers: headers('tag_task'),
      payload: { name: 'errand' },
    });
    expect(missing.statusCode).toBe(404);
  });

  it('resets everything, reporting what was deleted per type', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/tags',
      headers: headers('tag_task'),
      payload: { name: 'errand' },
    });
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/admin/reset',
      headers: headers('reset_demo'),
    });
    expect(res.json()).toEqual({ deletedTaskIds: ['task_0001'], deletedTagIds: ['tag_0001'] });

    const tasks = await ctx.app.inject({
      method: 'GET',
      url: '/tasks',
      headers: headers('list_tasks'),
    });
    expect(tasks.json()).toEqual([]);
  });

  it('new tasks default to MEDIUM priority with no tags', async () => {
    const list = await ctx.app.inject({
      method: 'GET',
      url: '/tasks',
      headers: headers('list_tasks'),
    });
    expect(list.json()[0]).toMatchObject({ priority: 'MEDIUM', tags: [] });
  });
});
