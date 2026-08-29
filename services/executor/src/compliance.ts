import type { FastifyReply, FastifyRequest } from 'fastify';
import { AuditLog } from './audit.js';
import type { CallerIdentity } from './types.js';

declare module 'fastify' {
  interface FastifyRequest {
    compliance?: CallerIdentity;
    auditEntityId?: string;
  }
}

/**
 * COMPLIANCE MIDDLEWARE — the architectural point of the executor.
 *
 * Every request must present verified-identity headers (the caller service has
 * already authenticated the end user; see /contracts/identity-headers.md), and
 * the (caller, tool) pair must be allowlisted for the exact route being hit.
 * Every decision — allowed or denied — is appended to the audit log with the
 * user and the AG-UI run id that caused the call.
 *
 * Production shape: same seam, but the caller would be authenticated with a
 * service credential (mTLS / signed service token) instead of trusted headers,
 * and the audit sink would be durable. A tracing hook (e.g. Langfuse) would
 * also attach here — this is deliberately the single choke point.
 */

/** Header names — kept in sync with /contracts/fixtures/identity-headers.json. */
export const HEADERS = {
  callerService: 'x-caller-service',
  userId: 'x-user-id',
  userEmail: 'x-user-email',
  agentRunId: 'x-agent-run-id',
  toolName: 'x-tool-name',
} as const;

/**
 * `${caller}:${tool}` → the one route (method + fastify url pattern) it may hit.
 *
 * SCALING NOTE (docs/SCALING.md): every mutation adds one row per caller — the
 * table doubled when the second batch of tools landed. That linear growth is
 * the honest cost of route-level authz; field-level authz (e.g. a generic
 * PATCH) would additionally need per-tool body validation here.
 */
export const TOOL_ALLOWLIST: Record<string, { method: string; route: string }> = {
  // agent backend tools
  'agent:create_task': { method: 'POST', route: '/tasks' },
  'agent:complete_task': { method: 'POST', route: '/tasks/:id/complete' },
  'agent:list_tasks': { method: 'GET', route: '/tasks' },
  'agent:rename_task': { method: 'POST', route: '/tasks/:id/rename' },
  'agent:set_due': { method: 'POST', route: '/tasks/:id/due' },
  'agent:set_priority': { method: 'POST', route: '/tasks/:id/priority' },
  'agent:reopen_task': { method: 'POST', route: '/tasks/:id/reopen' },
  'agent:delete_task': { method: 'DELETE', route: '/tasks/:id' },
  'agent:duplicate_task': { method: 'POST', route: '/tasks/:id/duplicate' },
  'agent:clear_completed': { method: 'POST', route: '/tasks/completed/clear' },
  'agent:create_tag': { method: 'POST', route: '/tags' },
  'agent:tag_task': { method: 'POST', route: '/tasks/:id/tags' },
  'agent:reset_demo': { method: 'POST', route: '/admin/reset' },
  // graphql facade operations
  'graphql:graphql.tasks': { method: 'GET', route: '/tasks' },
  'graphql:graphql.tags': { method: 'GET', route: '/tags' },
  'graphql:graphql.createTask': { method: 'POST', route: '/tasks' },
  'graphql:graphql.completeTask': { method: 'POST', route: '/tasks/:id/complete' },
  'graphql:graphql.renameTask': { method: 'POST', route: '/tasks/:id/rename' },
  'graphql:graphql.setDue': { method: 'POST', route: '/tasks/:id/due' },
  'graphql:graphql.setPriority': { method: 'POST', route: '/tasks/:id/priority' },
  'graphql:graphql.reopenTask': { method: 'POST', route: '/tasks/:id/reopen' },
  'graphql:graphql.deleteTask': { method: 'DELETE', route: '/tasks/:id' },
  'graphql:graphql.duplicateTask': { method: 'POST', route: '/tasks/:id/duplicate' },
  'graphql:graphql.clearCompleted': { method: 'POST', route: '/tasks/completed/clear' },
  'graphql:graphql.createTag': { method: 'POST', route: '/tags' },
  'graphql:graphql.tagTask': { method: 'POST', route: '/tasks/:id/tags' },
  'graphql:graphql.resetDemo': { method: 'POST', route: '/admin/reset' },
  // observability
  'e2e:audit.read': { method: 'GET', route: '/audit' },
};

const EXEMPT_ROUTES = new Set(['/healthz']);

const header = (request: FastifyRequest, name: string): string | undefined => {
  const value = request.headers[name];
  return typeof value === 'string' && value.length > 0 ? value : undefined;
};

export function complianceGuard(audit: AuditLog) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const route = request.routeOptions.url;
    if (!route || EXEMPT_ROUTES.has(route)) return;

    const identity: Partial<CallerIdentity> = {
      callerService: header(request, HEADERS.callerService),
      userId: header(request, HEADERS.userId),
      userEmail: header(request, HEADERS.userEmail),
      agentRunId: header(request, HEADERS.agentRunId),
      toolName: header(request, HEADERS.toolName),
    };

    const deny = (status: 401 | 403, reason: string): void => {
      audit.append({
        ts: new Date().toISOString(),
        decision: 'denied',
        reason,
        callerService: identity.callerService ?? null,
        userId: identity.userId ?? null,
        userEmail: identity.userEmail ?? null,
        runId: identity.agentRunId ?? null,
        tool: identity.toolName ?? null,
        method: request.method,
        route,
        status,
      });
      void reply.status(status).send({ error: reason });
    };

    if (!identity.callerService || !identity.userId || !identity.toolName) {
      return deny(
        401,
        `missing identity headers (${HEADERS.callerService}, ${HEADERS.userId}, ${HEADERS.toolName} are required)`,
      );
    }
    if (identity.callerService === 'agent' && !identity.agentRunId) {
      return deny(401, `caller 'agent' must send ${HEADERS.agentRunId}`);
    }

    const allowed = TOOL_ALLOWLIST[`${identity.callerService}:${identity.toolName}`];
    if (!allowed) {
      return deny(
        403,
        `tool '${identity.toolName}' is not allowlisted for caller '${identity.callerService}'`,
      );
    }
    if (allowed.method !== request.method || allowed.route !== route) {
      return deny(
        403,
        `tool '${identity.toolName}' is allowlisted for ${allowed.method} ${allowed.route}, not ${request.method} ${route}`,
      );
    }

    request.compliance = identity as CallerIdentity;
  };
}

/** onResponse hook: audit every allowed request once its outcome is known. */
export function auditResponse(audit: AuditLog) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const identity = request.compliance;
    if (!identity) return;
    audit.append({
      ts: new Date().toISOString(),
      decision: 'allowed',
      callerService: identity.callerService,
      userId: identity.userId,
      userEmail: identity.userEmail ?? null,
      runId: identity.agentRunId ?? null,
      tool: identity.toolName,
      method: request.method,
      route: request.routeOptions.url ?? request.url,
      entityId: request.auditEntityId,
      status: reply.statusCode,
    });
  };
}
