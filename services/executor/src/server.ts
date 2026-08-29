import Fastify, { type FastifyInstance } from 'fastify';
import { AuditLog } from './audit.js';
import { auditResponse, complianceGuard } from './compliance.js';
import { TaskStore } from './store.js';

export interface BuildOptions {
  /** Directory for the JSONL audit mirror; omit for in-memory only (tests). */
  dataDir?: string | null;
  logger?: boolean;
}

export interface ExecutorApp {
  app: FastifyInstance;
  store: TaskStore;
  audit: AuditLog;
}

export function buildServer(options: BuildOptions = {}): ExecutorApp {
  const app = Fastify({ logger: options.logger ?? false });
  const store = new TaskStore();
  const audit = new AuditLog(options.dataDir);

  app.addHook('preHandler', complianceGuard(audit));
  app.addHook('onResponse', auditResponse(audit));

  app.get('/healthz', async () => ({ ok: true, service: 'executor' }));

  app.get('/tasks', async () => store.list());

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
      const task = store.create(request.body);
      request.auditEntityId = task.id;
      return reply.status(201).send(task);
    },
  );

  app.post<{ Params: { id: string } }>('/tasks/:id/complete', async (request, reply) => {
    const task = store.complete(request.params.id);
    request.auditEntityId = request.params.id;
    if (!task) {
      return reply.status(404).send({ error: `no task with id '${request.params.id}'` });
    }
    return task;
  });

  app.get<{ Querystring: { runId?: string; userId?: string } }>('/audit', async (request) =>
    audit.query(request.query),
  );

  return { app, store, audit };
}
