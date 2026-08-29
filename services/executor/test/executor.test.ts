import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildServer, type ExecutorApp } from '../src/server.js';

const agentHeaders = {
  'x-caller-service': 'agent',
  'x-user-id': 'user-demo',
  'x-user-email': 'demo@example.com',
  'x-agent-run-id': 'run-test-1',
  'x-tool-name': 'create_task',
};

describe('executor', () => {
  let ctx: ExecutorApp;

  beforeEach(() => {
    ctx = buildServer();
  });

  it('healthz needs no identity headers', async () => {
    const res = await ctx.app.inject({ method: 'GET', url: '/healthz' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ok: true, service: 'executor' });
  });

  it('creates a task with a deterministic sequential id and audits who/which run', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/tasks',
      headers: agentHeaders,
      payload: { title: 'buy milk' },
    });
    expect(res.statusCode).toBe(201);
    const task = res.json();
    expect(task).toMatchObject({ id: 'task_0001', title: 'buy milk', due: null, completed: false });

    const audit = ctx.audit.query({ runId: 'run-test-1' });
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      decision: 'allowed',
      callerService: 'agent',
      userId: 'user-demo',
      runId: 'run-test-1',
      tool: 'create_task',
      entityId: 'task_0001',
      status: 201,
    });
  });

  it('lists and completes tasks', async () => {
    await ctx.app.inject({
      method: 'POST',
      url: '/tasks',
      headers: agentHeaders,
      payload: { title: 'buy milk' },
    });

    const list = await ctx.app.inject({
      method: 'GET',
      url: '/tasks',
      headers: { ...agentHeaders, 'x-tool-name': 'list_tasks' },
    });
    expect(list.statusCode).toBe(200);
    expect(list.json()).toHaveLength(1);

    const complete = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_0001/complete',
      headers: { ...agentHeaders, 'x-tool-name': 'complete_task' },
    });
    expect(complete.statusCode).toBe(200);
    expect(complete.json()).toMatchObject({ id: 'task_0001', completed: true });
  });

  it('404s when completing an unknown task', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/tasks/task_9999/complete',
      headers: { ...agentHeaders, 'x-tool-name': 'complete_task' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('rejects a body without a title', async () => {
    const res = await ctx.app.inject({
      method: 'POST',
      url: '/tasks',
      headers: agentHeaders,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  describe('compliance middleware', () => {
    it('401s and audits when identity headers are missing', async () => {
      const res = await ctx.app.inject({ method: 'GET', url: '/tasks' });
      expect(res.statusCode).toBe(401);
      const denied = ctx.audit.query();
      expect(denied).toHaveLength(1);
      expect(denied[0]).toMatchObject({ decision: 'denied', status: 401 });
      expect(denied[0]?.reason).toContain('missing identity headers');
    });

    it('401s when the agent caller omits the run id', async () => {
      const headers: Record<string, string> = { ...agentHeaders, 'x-tool-name': 'list_tasks' };
      delete headers['x-agent-run-id'];
      const res = await ctx.app.inject({ method: 'GET', url: '/tasks', headers });
      expect(res.statusCode).toBe(401);
      expect(res.json().error).toContain('x-agent-run-id');
    });

    it('403s a tool that is not allowlisted for the caller', async () => {
      const res = await ctx.app.inject({
        method: 'GET',
        url: '/tasks',
        headers: { ...agentHeaders, 'x-caller-service': 'unknown-service' },
      });
      expect(res.statusCode).toBe(403);
      expect(res.json().error).toContain('not allowlisted');
    });

    it('403s an allowlisted tool used against the wrong route', async () => {
      // agent:list_tasks may only GET /tasks — using it to mutate is denied and audited.
      const res = await ctx.app.inject({
        method: 'POST',
        url: '/tasks',
        headers: { ...agentHeaders, 'x-tool-name': 'list_tasks' },
        payload: { title: 'sneaky' },
      });
      expect(res.statusCode).toBe(403);
      const denied = ctx.audit.query().filter((e) => e.decision === 'denied');
      expect(denied).toHaveLength(1);
      expect(denied[0]?.tool).toBe('list_tasks');
    });

    it('serves the audit log filtered by run id to the e2e caller', async () => {
      await ctx.app.inject({
        method: 'POST',
        url: '/tasks',
        headers: agentHeaders,
        payload: { title: 'buy milk' },
      });
      await ctx.app.inject({
        method: 'POST',
        url: '/tasks',
        headers: { ...agentHeaders, 'x-agent-run-id': 'run-other' },
        payload: { title: 'other run' },
      });

      const res = await ctx.app.inject({
        method: 'GET',
        url: '/audit?runId=run-test-1',
        headers: {
          'x-caller-service': 'e2e',
          'x-user-id': 'user-demo',
          'x-tool-name': 'audit.read',
        },
      });
      expect(res.statusCode).toBe(200);
      const entries = res.json();
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ runId: 'run-test-1', entityId: 'task_0001' });
    });
  });

  it('mirrors audit entries to a JSONL file when a data dir is set', async () => {
    const dataDir = mkdtempSync(join(tmpdir(), 'executor-audit-'));
    const fileCtx = buildServer({ dataDir });
    await fileCtx.app.inject({
      method: 'POST',
      url: '/tasks',
      headers: agentHeaders,
      payload: { title: 'buy milk' },
    });
    const lines = readFileSync(join(dataDir, 'audit.log.jsonl'), 'utf8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({ decision: 'allowed', entityId: 'task_0001' });
  });
});
