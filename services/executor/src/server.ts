import Fastify, { type FastifyInstance, type FastifyReply } from 'fastify';
import { AuditLog } from './audit.js';
import { auditResponse, complianceGuard } from './compliance.js';
import { DemoStore } from './store.js';
import type { Priority } from './types.js';

export interface BuildOptions {
  /** Directory for the JSONL audit mirror; omit for in-memory only (tests). */
  dataDir?: string | null;
  logger?: boolean;
}

export interface ExecutorApp {
  app: FastifyInstance;
  store: DemoStore;
  audit: AuditLog;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** True only for real calendar dates — Date.parse alone rolls 2026-02-31 over. */
function isValidIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number) as [number, number, number];
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function buildServer(options: BuildOptions = {}): ExecutorApp {
  const app = Fastify({ logger: options.logger ?? false });
  const store = new DemoStore();
  const audit = new AuditLog(options.dataDir);

  app.addHook('preHandler', complianceGuard(audit));
  app.addHook('onResponse', auditResponse(audit));

  const notFound = (reply: FastifyReply, id: string) =>
    reply.status(404).send({ error: `no task with id '${id}'` });

  app.get('/healthz', async () => ({ ok: true, service: 'executor' }));

  // ── tasks ────────────────────────────────────────────────────────────────

  app.get('/tasks', async () => store.listTasks());

  app.post<{ Body: { title: string; due?: string | null } }>(
    '/tasks',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          additionalProperties: false,
          properties: {
            title: { type: 'string', minLength: 1 },
            due: { type: ['string', 'null'] },
          },
        },
      },
    },
    async (request, reply) => {
      const task = store.createTask(request.body);
      request.auditEntityId = task.id;
      return reply.status(201).send(task);
    },
  );

  app.post<{ Params: { id: string } }>('/tasks/:id/complete', async (request, reply) => {
    request.auditEntityId = request.params.id;
    const task = store.completeTask(request.params.id);
    return task ?? notFound(reply, request.params.id);
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/reopen', async (request, reply) => {
    request.auditEntityId = request.params.id;
    const task = store.reopenTask(request.params.id);
    return task ?? notFound(reply, request.params.id);
  });

  app.post<{ Params: { id: string }; Body: { title: string } }>(
    '/tasks/:id/rename',
    {
      schema: {
        body: {
          type: 'object',
          required: ['title'],
          additionalProperties: false,
          properties: { title: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      request.auditEntityId = request.params.id;
      const task = store.renameTask(request.params.id, request.body.title);
      return task ?? notFound(reply, request.params.id);
    },
  );

  app.post<{ Params: { id: string }; Body: { due: string | null } }>(
    '/tasks/:id/due',
    {
      schema: {
        body: {
          type: 'object',
          required: ['due'],
          additionalProperties: false,
          properties: { due: { type: ['string', 'null'] } },
        },
      },
    },
    async (request, reply) => {
      request.auditEntityId = request.params.id;
      const { due } = request.body;
      // Validation edge the agent's tool-error path exercises: a due date must
      // be a real ISO calendar date (null clears it).
      if (due !== null && !isValidIsoDate(due)) {
        return reply
          .status(400)
          .send({ error: `'${due}' is not a valid ISO date (expected YYYY-MM-DD)` });
      }
      const task = store.setDue(request.params.id, due);
      return task ?? notFound(reply, request.params.id);
    },
  );

  app.post<{ Params: { id: string }; Body: { priority: Priority } }>(
    '/tasks/:id/priority',
    {
      schema: {
        body: {
          type: 'object',
          required: ['priority'],
          additionalProperties: false,
          properties: { priority: { enum: ['LOW', 'MEDIUM', 'HIGH'] } },
        },
      },
    },
    async (request, reply) => {
      request.auditEntityId = request.params.id;
      const task = store.setPriority(request.params.id, request.body.priority);
      return task ?? notFound(reply, request.params.id);
    },
  );

  app.delete<{ Params: { id: string } }>('/tasks/:id', async (request, reply) => {
    request.auditEntityId = request.params.id;
    const task = store.deleteTask(request.params.id);
    return task ?? notFound(reply, request.params.id);
  });

  app.post<{ Params: { id: string } }>('/tasks/:id/duplicate', async (request, reply) => {
    const copy = store.duplicateTask(request.params.id);
    if (!copy) return notFound(reply, request.params.id);
    request.auditEntityId = copy.id;
    return reply.status(201).send(copy);
  });

  // Static segment beats :id in fastify's router, so this never collides with
  // /tasks/:id/... routes (pinned by a test).
  app.post('/tasks/completed/clear', async (request) => {
    const deleted = store.clearCompleted();
    request.auditEntityId = deleted.map((t) => t.id).join(',') || undefined;
    return { deleted };
  });

  // ── tags ─────────────────────────────────────────────────────────────────

  app.get('/tags', async () => store.listTags());

  app.post<{ Body: { name: string } }>(
    '/tags',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      const tag = store.createTag(request.body.name);
      // Conflict edge: tag names are unique case-insensitively.
      if (!tag) {
        return reply
          .status(409)
          .send({ error: `a tag named '${request.body.name}' already exists` });
      }
      request.auditEntityId = tag.id;
      return reply.status(201).send(tag);
    },
  );

  app.post<{ Params: { id: string }; Body: { name: string } }>(
    '/tasks/:id/tags',
    {
      schema: {
        body: {
          type: 'object',
          required: ['name'],
          additionalProperties: false,
          properties: { name: { type: 'string', minLength: 1 } },
        },
      },
    },
    async (request, reply) => {
      request.auditEntityId = request.params.id;
      const result = store.tagTask(request.params.id, request.body.name);
      return result ?? notFound(reply, request.params.id);
    },
  );

  // ── everything ───────────────────────────────────────────────────────────

  app.post('/admin/reset', async () => store.reset());

  app.get<{ Querystring: { runId?: string; userId?: string } }>('/audit', async (request) =>
    audit.query(request.query),
  );

  return { app, store, audit };
}
