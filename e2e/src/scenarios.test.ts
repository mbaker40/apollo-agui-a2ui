/**
 * Scripted-conversation e2e scenarios (handoff §4, 1–3) against the LIVE
 * stack: agent (AG-UI SSE) → executor (REST + compliance) ← graphql facade.
 * Scenario 4 (web reconciliation) lives in apps/web/test/reconcile.test.tsx;
 * scenario 5 (mobile cores) in the Kotlin/Swift test suites.
 */
import { OPEN_TASK_TOOL } from '@mwe/contracts';
import { describe, expect, it } from 'vitest';
import {
  auditEntries,
  customEvents,
  eventTypes,
  fullText,
  gql,
  runAgentOverHttp,
  toolCallStarts,
  userMessage,
  type AgUiEvent,
} from './helpers.js';

// Vitest's file order is not guaranteed — each scenario file resets the world
// first and captures entity ids from events (the executor never reuses ids).
let milkId = '';

describe('scenario 0: auth gate (and a clean slate)', () => {
  it('resets the demo world', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_e2e_reset',
      messages: [userMessage('start over')],
    });
    expect(fullText(events)).toContain('Fresh start');
  });

  it('rejects an agent run without a bearer token', async () => {
    await expect(
      runAgentOverHttp({ runId: 'run_e2e_noauth', messages: [userMessage('hi')], token: null }),
    ).rejects.toThrow(/401/);
  });

  it('rejects GraphQL without a bearer token', async () => {
    const res = await gql('{ tasks { id } }', {}, null);
    expect(res.status).toBe(401);
  });
});

describe('scenario 1: backend write through the executor path', () => {
  it('creates a task via chat, emits entity_changed, lands in GraphQL, and is audited', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_e2e_1',
      messages: [userMessage('add a task to buy milk')],
    });

    // SSE stream shape: run frame, one create_task tool round-trip,
    // the entity_changed announcement, then streamed confirmation text.
    expect(eventTypes(events)[0]).toBe('RUN_STARTED');
    expect(eventTypes(events).at(-1)).toBe('RUN_FINISHED');
    expect(toolCallStarts(events).map((e) => e.toolCallName)).toEqual(['create_task']);
    const customs = customEvents(events);
    expect(customs).toHaveLength(1);
    milkId = customs[0]!.value.id;
    expect(customs[0]).toEqual({
      type: 'CUSTOM',
      name: 'entity_changed',
      value: { typename: 'Task', id: milkId, kind: 'CREATED', scope: 'tasks' },
    });
    expect(fullText(events)).toBe(`Created "buy milk" (${milkId}). Anything else?`);

    // The write is visible through the GraphQL facade (which reads via the executor).
    const tasks = await gql<{ tasks: { id: string; title: string; completed: boolean }[] }>(
      '{ tasks { id title completed } }',
    );
    expect(tasks.errors).toBeUndefined();
    expect(tasks.data?.tasks).toEqual([{ id: milkId, title: 'buy milk', completed: false }]);

    // The audit log attributes the write to the verified user AND the AG-UI run.
    const audit = await auditEntries('run_e2e_1');
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      decision: 'allowed',
      callerService: 'agent',
      userId: 'user-demo',
      userEmail: 'demo@example.com',
      runId: 'run_e2e_1',
      tool: 'create_task',
      entityId: milkId,
      status: 201,
    });
  });
});

describe('scenario 2: read-then-write', () => {
  it('lists, completes the matching task, emits UPDATED, GraphQL shows completed', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_e2e_2',
      messages: [userMessage("I'm done with the milk one")],
    });

    expect(toolCallStarts(events).map((e) => e.toolCallName)).toEqual([
      'list_tasks',
      'complete_task',
    ]);
    expect(customEvents(events)).toEqual([
      {
        type: 'CUSTOM',
        name: 'entity_changed',
        value: { typename: 'Task', id: milkId, kind: 'UPDATED', scope: 'tasks' },
      },
    ]);
    expect(fullText(events)).toBe('Nice — marked "buy milk" as done.');

    const tasks = await gql<{ tasks: { id: string; completed: boolean }[] }>(
      '{ tasks { id completed } }',
    );
    expect(tasks.data?.tasks).toEqual([{ id: milkId, completed: true }]);

    const audit = await auditEntries('run_e2e_2');
    expect(audit.map((e) => e.tool)).toEqual(['list_tasks', 'complete_task']);
    expect(audit.every((e) => e.userId === 'user-demo' && e.decision === 'allowed')).toBe(true);
  });
});

describe('scenario 3: hybrid frontend tool', () => {
  it('with open_task advertised: defers the call, then reflects the client result', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_e2e_3',
      messages: [userMessage('open the milk task')],
      tools: [OPEN_TASK_TOOL],
    });

    // The run ends on the deferred frontend call: no result for it, no text.
    expect(toolCallStarts(events).map((e) => e.toolCallName)).toEqual(['list_tasks', 'open_task']);
    expect(eventTypes(events).at(-1)).toBe('RUN_FINISHED');
    expect(fullText(events)).toBe('');
    const openCall = toolCallStarts(events)[1]!;
    const results = events.filter((e) => e.type === 'TOOL_CALL_RESULT');
    expect(results).toHaveLength(1); // list_tasks only
    expect(results[0]!.toolCallId).not.toBe(openCall.toolCallId);

    // Simulate the client tool loop: rebuild history from the events, execute
    // open_task locally, and continue the run with the tool result appended.
    const continuation = await runAgentOverHttp({
      runId: 'run_e2e_4',
      messages: continuationMessages(events, { status: 'opened', id: milkId }),
      tools: [OPEN_TASK_TOOL],
    });
    expect(fullText(continuation)).toBe('Opened "buy milk" for you.');
    expect(toolCallStarts(continuation)).toHaveLength(0);

    // open_task never reached the executor: nothing audited under either run.
    expect(await auditEntries('run_e2e_4')).toHaveLength(0);
  });

  it('without open_task advertised: no tool call, capability-aware fallback text', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_e2e_5',
      messages: [userMessage('open the milk task')],
    });

    expect(toolCallStarts(events)).toHaveLength(0);
    expect(fullText(events)).toContain("didn't advertise the open_task tool");
    expect(await auditEntries('run_e2e_5')).toHaveLength(0);
  });
});

/** What a real client's tool loop reconstructs from run events + its local tool result. */
function continuationMessages(events: AgUiEvent[], toolResult: unknown): unknown[] {
  const messages: unknown[] = [userMessage('open the milk task')];
  const starts = toolCallStarts(events);
  for (const start of starts) {
    const args = events
      .filter((e) => e.type === 'TOOL_CALL_ARGS' && e.toolCallId === start.toolCallId)
      .map((e) => e.delta as string)
      .join('');
    messages.push({
      id: start.parentMessageId,
      role: 'assistant',
      toolCalls: [
        {
          id: start.toolCallId,
          type: 'function',
          function: { name: start.toolCallName, arguments: args },
        },
      ],
    });
    const result = events.find(
      (e) => e.type === 'TOOL_CALL_RESULT' && e.toolCallId === start.toolCallId,
    );
    if (result) {
      messages.push({
        id: result.messageId,
        role: 'tool',
        toolCallId: start.toolCallId,
        content: result.content,
      });
    }
  }
  const lastStart = starts.at(-1)!;
  messages.push({
    id: 'client_tool_result_1',
    role: 'tool',
    toolCallId: lastStart.toolCallId,
    content: JSON.stringify(toolResult),
  });
  return messages;
}
