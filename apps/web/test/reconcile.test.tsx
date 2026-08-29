/**
 * Scenario 4 (handoff §4): web reconciliation, component-level.
 * With a mounted watched query, an emitted entity_changed refetches EXACTLY
 * the affected active query; with nothing mounted (never-fetched), zero
 * requests. v2 adds: a second typename/scope (Tag) proving registry isolation,
 * and the bulk-DELETED behavior pin (one refetch per event — see SCALING.md).
 */
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { asyncScheduler, observeOn, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TagsStrip, TaskList } from '../src/components/TaskList';
import { createRefetchEventManager } from '../src/lib/reconcile';
import type { Tag, Task } from '../src/graphql/queries';
import type { EntityChangedPayload } from '@mwe/contracts';

interface Harness {
  client: ApolloClient;
  manager: ReturnType<typeof createRefetchEventManager>;
  tasks: Task[];
  tags: Tag[];
  fetchCount: (operation: 'Tasks' | 'Tags') => number;
}

function makeHarness(): Harness {
  const tasks: Task[] = [];
  const tags: Tag[] = [];
  const counts: Record<string, number> = {};
  const link = new ApolloLink((operation) => {
    const name = operation.operationName ?? 'anonymous';
    counts[name] = (counts[name] ?? 0) + 1;
    const data =
      name === 'Tags'
        ? { tags: tags.map((t) => ({ ...t })) }
        : { tasks: tasks.map((t) => ({ ...t, tags: t.tags.map((x) => ({ ...x })) })) };
    // Async like a real network hop — a synchronously-emitting link re-enters
    // the cache mid-refetch-batch ("already recomputing").
    return of({ data }).pipe(observeOn(asyncScheduler));
  });
  const manager = createRefetchEventManager();
  const client = new ApolloClient({
    link,
    cache: new InMemoryCache(),
    refetchEventManager: manager,
  });
  return { client, manager, tasks, tags, fetchCount: (op) => counts[op] ?? 0 };
}

function task(id: string, title: string, completed = false): Task {
  return {
    __typename: 'Task',
    id,
    title,
    due: null,
    completed,
    priority: 'MEDIUM',
    tags: [],
  };
}

function changed(
  partial: Partial<EntityChangedPayload> & Pick<EntityChangedPayload, 'id' | 'kind'>,
): EntityChangedPayload {
  return { typename: 'Task', scope: 'tasks', ...partial };
}

describe('entity_changed → RefetchEventManager reconciliation', () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  afterEach(() => {
    cleanup();
    h.client.stop();
  });

  function mountTaskList() {
    return render(
      <ApolloProvider client={h.client}>
        <TaskList selectedTaskId={null} />
      </ApolloProvider>,
    );
  }

  it('refetches the active watched query on CREATED and UPDATED', async () => {
    const view = mountTaskList();
    await waitFor(() => expect(h.fetchCount('Tasks')).toBe(1));

    h.tasks.push(task('task_0001', 'buy milk'));
    h.manager.emit('entityChanged', changed({ id: 'task_0001', kind: 'CREATED' }));

    await waitFor(() => expect(view.getByTestId('task-task_0001')).toBeTruthy());
    expect(h.fetchCount('Tasks')).toBe(2);

    h.tasks[0] = task('task_0001', 'buy milk', true);
    h.manager.emit('entityChanged', changed({ id: 'task_0001', kind: 'UPDATED' }));

    await waitFor(() =>
      expect(view.getByTestId('task-task_0001').className).toContain('completed'),
    );
    expect(h.fetchCount('Tasks')).toBe(3);
  });

  it('a Tag event refetches ONLY the tags query — registry isolation per typename', async () => {
    const view = mountTaskList(); // mounts both watched queries (list + strip)
    await waitFor(() => expect(h.fetchCount('Tasks')).toBe(1));
    await waitFor(() => expect(h.fetchCount('Tags')).toBe(1));

    h.tags.push({ __typename: 'Tag', id: 'tag_0001', name: 'urgent' });
    h.manager.emit(
      'entityChanged',
      changed({ typename: 'Tag', id: 'tag_0001', kind: 'CREATED', scope: 'tags' }),
    );

    await waitFor(() => expect(view.getByTestId('tag-tag_0001')).toBeTruthy());
    expect(h.fetchCount('Tags')).toBe(2);
    expect(h.fetchCount('Tasks')).toBe(1); // untouched
  });

  it('bulk DELETED: back-to-back events coalesce into ONE in-flight refetch (dedup)', async () => {
    const view = mountTaskList();
    await waitFor(() => expect(h.fetchCount('Tasks')).toBe(1));
    h.tasks.push(task('task_0001', 'buy milk'), task('task_0002', 'call the vet'));
    h.manager.emit('entityChanged', changed({ id: 'task_0001', kind: 'CREATED' }));
    await waitFor(() => expect(view.getByTestId('task-task_0002')).toBeTruthy());
    const before = h.fetchCount('Tasks');

    // A bulk run (clear_completed, reset_demo) delivers events back-to-back.
    // Both emits invalidate + request a refetch synchronously, and Apollo's
    // query deduplication collapses the identical in-flight fetches into one —
    // so bulk runs don't storm the network as long as events arrive within
    // one round-trip. Events spaced wider than a round-trip fetch once each
    // (see docs/SCALING.md).
    h.tasks.length = 0;
    h.manager.emit('entityChanged', changed({ id: 'task_0001', kind: 'DELETED' }));
    h.manager.emit('entityChanged', changed({ id: 'task_0002', kind: 'DELETED' }));

    await waitFor(() => expect(view.queryByTestId('task-task_0001')).toBeNull());
    await waitFor(() => expect(view.queryByTestId('task-task_0002')).toBeNull());
    expect(h.fetchCount('Tasks')).toBe(before + 1);
  });

  it('an unknown typename with no registered list fields triggers no refetch', async () => {
    mountTaskList();
    await waitFor(() => expect(h.fetchCount('Tasks')).toBe(1));

    h.manager.emit(
      'entityChanged',
      changed({ typename: 'Widget', id: 'widget_1', kind: 'CREATED', scope: 'widgets' }),
    );
    await new Promise((r) => setTimeout(r, 50));
    expect(h.fetchCount('Tasks')).toBe(1);
    expect(h.fetchCount('Tags')).toBe(1);
  });

  it('a never-fetched (inactive) query triggers zero network requests', async () => {
    h.tasks.push(task('task_0001', 'buy milk'));
    h.manager.emit('entityChanged', changed({ id: 'task_0001', kind: 'CREATED' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(h.fetchCount('Tasks')).toBe(0);
    expect(h.fetchCount('Tags')).toBe(0);
  });

  it('stops refetching after the watched query unmounts', async () => {
    const view = mountTaskList();
    await waitFor(() => expect(h.fetchCount('Tasks')).toBe(1));
    view.unmount();
    await new Promise((r) => setTimeout(r, 10)); // let Apollo tear the watcher down

    h.tasks.push(task('task_0002', 'call the vet'));
    h.manager.emit('entityChanged', changed({ id: 'task_0002', kind: 'CREATED' }));
    await new Promise((r) => setTimeout(r, 50));
    expect(h.fetchCount('Tasks')).toBe(1);
  });

  it('DELETED evicts the entity from the cache', async () => {
    const view = mountTaskList();
    await waitFor(() => expect(h.fetchCount('Tasks')).toBe(1));
    h.tasks.push(task('task_0001', 'buy milk'));
    h.manager.emit('entityChanged', changed({ id: 'task_0001', kind: 'CREATED' }));
    await waitFor(() => expect(view.getByTestId('task-task_0001')).toBeTruthy());

    h.tasks.length = 0;
    h.manager.emit('entityChanged', changed({ id: 'task_0001', kind: 'DELETED' }));
    await waitFor(() => expect(view.queryByTestId('task-task_0001')).toBeNull());
    const extracted = h.client.cache.extract() as Record<string, unknown>;
    expect(extracted['Task:task_0001']).toBeUndefined();
  });

  it('TagsStrip alone reacts to tag events without a task query in sight', async () => {
    const view = render(
      <ApolloProvider client={h.client}>
        <TagsStrip />
      </ApolloProvider>,
    );
    await waitFor(() => expect(h.fetchCount('Tags')).toBe(1));

    h.tags.push({ __typename: 'Tag', id: 'tag_0001', name: 'urgent' });
    h.manager.emit(
      'entityChanged',
      changed({ typename: 'Tag', id: 'tag_0001', kind: 'CREATED', scope: 'tags' }),
    );
    await waitFor(() => expect(view.getByTestId('tag-tag_0001')).toBeTruthy());
    expect(h.fetchCount('Tasks')).toBe(0); // that query never even started
  });
});
