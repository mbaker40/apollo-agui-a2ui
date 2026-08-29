/**
 * TypeScript mirror of the cross-platform contracts in /contracts.
 * The JSON files under schemas/ and fixtures/ are the source of truth;
 * test/conformance.test.ts pins these exports to them.
 */

export type EntityChangeKind = 'CREATED' | 'UPDATED' | 'DELETED';

/** Payload of the AG-UI CUSTOM event named `entity_changed`. */
export interface EntityChangedPayload {
  typename: string;
  id: string;
  kind: EntityChangeKind;
  scope: string;
}

/** AG-UI CUSTOM event name used for cache reconciliation. */
export const ENTITY_CHANGED_EVENT = 'entity_changed';

/** Shape of a client-declared tool in RunAgentInput.tools. */
export interface FrontendToolDeclaration {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}

/** Canonical `open_task` declaration — must match fixtures/frontend-tools/open-task.json. */
export const OPEN_TASK_TOOL: FrontendToolDeclaration = {
  name: 'open_task',
  description:
    'Open the task with the given id in the client UI so the user can see it. Only call this when the current run declared it.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: {
      id: {
        type: 'string',
        description: 'Id of the task to open',
      },
    },
  },
};

export interface OpenTaskResult {
  status: 'opened' | 'not_found';
  id: string;
}

/** Identity headers forwarded to the executor — must match fixtures/identity-headers.json. */
export const IDENTITY_HEADERS = {
  callerService: 'x-caller-service',
  userId: 'x-user-id',
  userEmail: 'x-user-email',
  agentRunId: 'x-agent-run-id',
  toolName: 'x-tool-name',
} as const;

/** Invalidation scopes; v1 has a single scope. */
export const SCOPE_TASKS = 'tasks';
