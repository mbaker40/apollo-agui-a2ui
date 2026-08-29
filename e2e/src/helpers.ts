import { DEV_JWT_FALLBACK } from '@mwe/contracts/dev-auth';
import { AGENT_URL, EXECUTOR_URL, GRAPHQL_URL } from './stack.js';

/* eslint-disable @typescript-eslint/no-explicit-any */
export type AgUiEvent = Record<string, any> & { type: string };

export interface RunOptions {
  runId: string;
  threadId?: string;
  messages: unknown[];
  tools?: unknown[];
  token?: string | null;
}

/** POST a RunAgentInput to the agent and collect the SSE events. */
export async function runAgentOverHttp(options: RunOptions): Promise<AgUiEvent[]> {
  const token = options.token === undefined ? DEV_JWT_FALLBACK : options.token;
  const res = await fetch(AGENT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({
      threadId: options.threadId ?? 'thread_e2e',
      runId: options.runId,
      state: null,
      messages: options.messages,
      tools: options.tools ?? [],
      context: [],
      forwardedProps: null,
    }),
  });
  if (!res.ok) {
    throw new Error(`agent responded ${res.status}: ${await res.text()}`);
  }
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as AgUiEvent);
}

export function userMessage(text: string, id = 'u1'): unknown {
  return { id, role: 'user', content: text };
}

export function eventTypes(events: AgUiEvent[]): string[] {
  return events.map((e) => e.type);
}

export function fullText(events: AgUiEvent[]): string {
  return events
    .filter((e) => e.type === 'TEXT_MESSAGE_CONTENT')
    .map((e) => e.delta as string)
    .join('');
}

export function toolCallStarts(events: AgUiEvent[]): AgUiEvent[] {
  return events.filter((e) => e.type === 'TOOL_CALL_START');
}

export function customEvents(events: AgUiEvent[]): AgUiEvent[] {
  return events.filter((e) => e.type === 'CUSTOM');
}

export async function gql<T = any>(
  query: string,
  variables: Record<string, unknown> = {},
  token: string | null = DEV_JWT_FALLBACK,
): Promise<{ status: number; data?: T; errors?: any[] }> {
  const res = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const body = (await res.json()) as { data?: T; errors?: any[] };
  return { status: res.status, ...body };
}

/** Read the executor's audit log the compliant way: as the allowlisted e2e caller. */
export async function auditEntries(runId: string): Promise<Record<string, any>[]> {
  const res = await fetch(`${EXECUTOR_URL}/audit?runId=${encodeURIComponent(runId)}`, {
    headers: {
      'x-caller-service': 'e2e',
      'x-user-id': 'user-demo',
      'x-tool-name': 'audit.read',
    },
  });
  if (!res.ok) throw new Error(`audit read failed with ${res.status}`);
  return (await res.json()) as Record<string, any>[];
}
