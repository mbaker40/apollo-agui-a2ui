/**
 * v2 scripted conversation: the ten new mutations end-to-end, covering the
 * edge dimensions each was chosen for — validation 400, conflict 409, bulk
 * multi-event runs, cross-entity and cross-scope changes. Opens with a reset
 * so it is independent of whatever ran before; ids are captured from events
 * (the executor's sequences are deliberately never reused).
 */
import { describe, expect, it } from 'vitest';
import {
  auditEntries,
  customEvents,
  fullText,
  gql,
  runAgentOverHttp,
  toolCallStarts,
  userMessage,
} from './helpers.js';

let milkId = '';
let vetId = '';
let copyId = '';

describe('v2 scenario: a full conversation across the ten new mutations', () => {
  it('starts over (reset baseline)', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_v2_0',
      messages: [userMessage('start over')],
    });
    expect(fullText(events)).toContain('Fresh start');
    const tasks = await gql<{ tasks: unknown[] }>('{ tasks { id } }');
    expect(tasks.data?.tasks).toEqual([]);
  });

  it('seeds two tasks', async () => {
    const milk = await runAgentOverHttp({
      runId: 'run_v2_seed1',
      messages: [userMessage('add a task to buy milk')],
    });
    milkId = customEvents(milk)[0]!.value.id;
    const vet = await runAgentOverHttp({
      runId: 'run_v2_seed2',
      messages: [userMessage('add a task to call the vet')],
    });
    vetId = customEvents(vet)[0]!.value.id;
    expect(milkId).not.toBe(vetId);
  });

  it('rename_task → UPDATED, visible via GraphQL, audited', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_v2_rename',
      messages: [userMessage('rename the milk task to buy oat milk')],
    });
    expect(customEvents(events).map((e) => e.value)).toEqual([
      { typename: 'Task', id: milkId, kind: 'UPDATED', scope: 'tasks' },
    ]);
    expect(fullText(events)).toBe('Renamed it to "buy oat milk".');

    const tasks = await gql<{ tasks: { id: string; title: string }[] }>('{ tasks { id title } }');
    expect(tasks.data?.tasks.find((t) => t.id === milkId)?.title).toBe('buy oat milk');

    const audit = await auditEntries('run_v2_rename');
    expect(audit.map((e) => e.tool)).toEqual(['list_tasks', 'rename_task']);
    expect(audit[1]).toMatchObject({ decision: 'allowed', entityId: milkId, status: 200 });
  });

  it('set_due with a real date → UPDATED; with fuzzy wording → survivable 400', async () => {
    const ok = await runAgentOverHttp({
      runId: 'run_v2_due',
      messages: [userMessage('the oat milk task is due 2026-09-01')],
    });
    expect(customEvents(ok)).toHaveLength(1);
    expect(fullText(ok)).toBe('"buy oat milk" is now due 2026-09-01.');

    const bad = await runAgentOverHttp({
      runId: 'run_v2_due_bad',
      messages: [userMessage('the oat milk task is due tomorrow')],
    });
    // The tool round-trip failed 4xx: error result, no entity change, run FINISHES.
    expect(bad.some((e) => e.type === 'TOOL_CALL_RESULT' && e.content.includes('"error"'))).toBe(
      true,
    );
    expect(customEvents(bad)).toHaveLength(0);
    expect(bad.at(-1)!.type).toBe('RUN_FINISHED');
    expect(fullText(bad)).toBe(
      "That didn't work: 'tomorrow' is not a valid ISO date (expected YYYY-MM-DD)",
    );
    // Compliance saw the allowed-but-failed call: audited with status 400.
    const audit = await auditEntries('run_v2_due_bad');
    expect(audit.find((e) => e.tool === 'set_due')).toMatchObject({
      decision: 'allowed',
      status: 400,
    });
  });

  it('set_priority → UPDATED with the new schema field visible', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_v2_priority',
      messages: [userMessage('make the oat milk task high priority')],
    });
    expect(fullText(events)).toBe('Set "buy oat milk" to high priority.');
    const tasks = await gql<{ tasks: { id: string; priority: string }[] }>(
      '{ tasks { id priority } }',
    );
    expect(tasks.data?.tasks.find((t) => t.id === milkId)?.priority).toBe('HIGH');
  });

  it('tag_task auto-creates: one run, two entity_changed events across two scopes', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_v2_tag',
      messages: [userMessage('tag the oat milk task as urgent')],
    });
    const values = customEvents(events).map((e) => e.value);
    expect(values).toEqual([
      { typename: 'Task', id: milkId, kind: 'UPDATED', scope: 'tasks' },
      { typename: 'Tag', id: values[1]!.id, kind: 'CREATED', scope: 'tags' },
    ]);
    expect(fullText(events)).toContain('(new tag)');

    const data = await gql<{
      tasks: { id: string; tags: { name: string }[] }[];
      tags: { name: string }[];
    }>('{ tasks { id tags { name } } tags { name } }');
    expect(data.data?.tasks.find((t) => t.id === milkId)?.tags).toEqual([{ name: 'urgent' }]);
    expect(data.data?.tags).toEqual([{ name: 'urgent' }]);
  });

  it('create_tag conflict (409) is survivable and audited', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_v2_tag_dup',
      messages: [userMessage('add a tag called URGENT')],
    });
    expect(customEvents(events)).toHaveLength(0);
    expect(fullText(events)).toBe("That didn't work: a tag named 'URGENT' already exists");
    const audit = await auditEntries('run_v2_tag_dup');
    expect(audit[0]).toMatchObject({ tool: 'create_tag', decision: 'allowed', status: 409 });
  });

  it('duplicate_task → CREATED copy carrying tags, not completion', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_v2_dup',
      messages: [userMessage('duplicate the oat milk task')],
    });
    const created = customEvents(events)[0]!.value;
    expect(created).toMatchObject({ typename: 'Task', kind: 'CREATED', scope: 'tasks' });
    copyId = created.id;
    expect(fullText(events)).toBe(`Duplicated it as "buy oat milk (copy)" (${copyId}).`);
  });

  it('reopen_task → UPDATED back to open (and the not-completed edge speaks up)', async () => {
    await runAgentOverHttp({
      runId: 'run_v2_complete',
      messages: [userMessage("I'm done with the oat milk one")],
    });
    const events = await runAgentOverHttp({
      runId: 'run_v2_reopen',
      messages: [userMessage("actually I'm not done with the oat milk one")],
    });
    expect(customEvents(events).map((e) => e.value)).toEqual([
      { typename: 'Task', id: milkId, kind: 'UPDATED', scope: 'tasks' },
    ]);
    const tasks = await gql<{ tasks: { id: string; completed: boolean }[] }>(
      '{ tasks { id completed } }',
    );
    expect(tasks.data?.tasks.find((t) => t.id === milkId)?.completed).toBe(false);

    const edge = await runAgentOverHttp({
      runId: 'run_v2_reopen_edge',
      messages: [userMessage('reopen the vet task')],
    });
    expect(toolCallStarts(edge).map((e) => e.toolCallName)).toEqual(['list_tasks']);
    expect(fullText(edge)).toBe(
      '"call the vet" isn\'t marked done, so there\'s nothing to reopen.',
    );
  });

  it('delete_task → DELETED, gone from GraphQL, audited as DELETE', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_v2_delete',
      messages: [userMessage('delete the vet task')],
    });
    expect(customEvents(events).map((e) => e.value)).toEqual([
      { typename: 'Task', id: vetId, kind: 'DELETED', scope: 'tasks' },
    ]);
    const tasks = await gql<{ tasks: { id: string }[] }>('{ tasks { id } }');
    expect(tasks.data?.tasks.map((t) => t.id)).not.toContain(vetId);
    const audit = await auditEntries('run_v2_delete');
    expect(audit.find((e) => e.tool === 'delete_task')).toMatchObject({
      method: 'DELETE',
      entityId: vetId,
    });
  });

  it('clear_completed → one DELETED per removed task in a single run', async () => {
    await runAgentOverHttp({
      runId: 'run_v2_done1',
      messages: [userMessage("I'm done with the oat milk one")],
    });
    await runAgentOverHttp({
      runId: 'run_v2_done2',
      messages: [userMessage("I'm done with the copy one")],
    });

    const events = await runAgentOverHttp({
      runId: 'run_v2_clear',
      messages: [userMessage('clear my completed tasks')],
    });
    const values = customEvents(events).map((e) => e.value);
    expect(values).toEqual([
      { typename: 'Task', id: milkId, kind: 'DELETED', scope: 'tasks' },
      { typename: 'Task', id: copyId, kind: 'DELETED', scope: 'tasks' },
    ]);
    expect(fullText(events)).toBe('Cleared 2 completed tasks.');

    // Nothing-to-clear edge: zero events, honest text.
    const again = await runAgentOverHttp({
      runId: 'run_v2_clear2',
      messages: [userMessage('clear my completed tasks')],
    });
    expect(customEvents(again)).toHaveLength(0);
    expect(fullText(again)).toBe('There are no completed tasks to clear.');
  });

  it('reset_demo → cross-scope DELETED sweep, empty world via GraphQL', async () => {
    const events = await runAgentOverHttp({
      runId: 'run_v2_reset',
      messages: [userMessage('start over')],
    });
    const values = customEvents(events).map((e) => e.value);
    // Everything left is announced: remaining tasks (none) + the urgent tag.
    expect(
      values.some((v) => v.typename === 'Tag' && v.kind === 'DELETED' && v.scope === 'tags'),
    ).toBe(true);
    expect(fullText(events)).toContain('Fresh start');

    const world = await gql<{ tasks: unknown[]; tags: unknown[] }>('{ tasks { id } tags { id } }');
    expect(world.data).toEqual({ tasks: [], tags: [] });
  });
});
