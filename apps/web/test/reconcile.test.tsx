/**
 * Scenario 4 (handoff §4): web reconciliation, component-level.
 * With a mounted watched query, an emitted entity_changed refetches EXACTLY
 * the active query; with nothing mounted (never-fetched), zero requests.
 */
import { ApolloClient, ApolloLink, InMemoryCache } from '@apollo/client';
import { ApolloProvider } from '@apollo/client/react';
import { cleanup, render, waitFor } from '@testing-library/react';
import { asyncScheduler, observeOn, of } from 'rxjs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TaskList } from '../src/components/TaskList';
import { createRefetchEventManager } from '../src/lib/reconcile';
import type { Task } from '../src/graphql/queries';

interface Harness {
  client: ApolloClient;
  manager: ReturnType<typeof createRefetchEventManager>;
  backend: Task[];
  fetchCount: () => number;
}

function makeHarness(): Harness {
  const backend: Task[] = [];
  let count = 0;
  const link = new ApolloLink(() => {
    count += 1;
    // Async like a real network hop — a synchronously-emitting link re-enters
    // the cache mid-refetch-batch ("already recomputing").
    return of({ data: { tasks: backend.map((t) => ({ ...t })) } }).pipe(observeOn(asyncScheduler));
  });
  const manager = createRefetchEventManager();
  const client = new ApolloClient({
    link,
    cache: new InMemoryCache(),
    refetchEventManager: manager,
  });
  return { client, manager, backend, fetchCount: () => count };
}

function task(id: string, title: string, completed = false): Task {
  return { __typename: 'Task', id, title, due: null, completed };
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

  it('refetches the active watched query on CREATED and UPDATED', async () => {
    const view = render(
      <ApolloProvider client={h.client}>
        <TaskList selectedTaskId={null} />
      </ApolloProvider>,
    );
    await waitFor(() => expect(h.fetchCount()).toBe(1));

    // Backend write happened via the agent path; the event announces it.
    h.backend.push(task('task_0001', 'buy milk'));
    h.manager.emit('entityChanged', {
      typename: 'Task',
      id: 'task_0001',
      kind: 'CREATED',
      scope: 'tasks',
    });

    await waitFor(() => expect(view.getByTestId('task-task_0001')).toBeTruthy());
    expect(h.fetchCount()).toBe(2);

    h.backend[0] = task('task_0001', 'buy milk', true);
    h.manager.emit('entityChanged', {
      typename: 'Task',
      id: 'task_0001',
      kind: 'UPDATED',
      scope: 'tasks',
    });

    await waitFor(() =>
      expect(view.getByTestId('task-task_0001').className).toContain('completed'),
    );
    expect(h.fetchCount()).toBe(3);
  });

  it('an unknown typename with no registered list fields triggers no refetch', async () => {
    const view = render(
      <ApolloProvider client={h.client}>
        <TaskList selectedTaskId={null} />
      </ApolloProvider>,
    );
    await waitFor(() => expect(h.fetchCount()).toBe(1));

    h.manager.emit('entityChanged', {
      typename: 'Widget',
      id: 'widget_1',
      kind: 'CREATED',
      scope: 'widgets',
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.fetchCount()).toBe(1);
    view.unmount();
  });

  it('a never-fetched (inactive) query triggers zero network requests', async () => {
    // Nothing mounted: the tasks query has never been watched or fetched.
    h.backend.push(task('task_0001', 'buy milk'));
    h.manager.emit('entityChanged', {
      typename: 'Task',
      id: 'task_0001',
      kind: 'CREATED',
      scope: 'tasks',
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.fetchCount()).toBe(0);
  });

  it('stops refetching after the watched query unmounts', async () => {
    const view = render(
      <ApolloProvider client={h.client}>
        <TaskList selectedTaskId={null} />
      </ApolloProvider>,
    );
    await waitFor(() => expect(h.fetchCount()).toBe(1));
    view.unmount();
    await new Promise((r) => setTimeout(r, 10)); // let Apollo tear the watcher down

    h.backend.push(task('task_0002', 'call the vet'));
    h.manager.emit('entityChanged', {
      typename: 'Task',
      id: 'task_0002',
      kind: 'CREATED',
      scope: 'tasks',
    });
    await new Promise((r) => setTimeout(r, 50));
    expect(h.fetchCount()).toBe(1);
  });

  it('DELETED evicts the entity from the cache', async () => {
    const view = render(
      <ApolloProvider client={h.client}>
        <TaskList selectedTaskId={null} />
      </ApolloProvider>,
    );
    await waitFor(() => expect(h.fetchCount()).toBe(1));
    h.backend.push(task('task_0001', 'buy milk'));
    h.manager.emit('entityChanged', {
      typename: 'Task',
      id: 'task_0001',
      kind: 'CREATED',
      scope: 'tasks',
    });
    await waitFor(() => expect(view.getByTestId('task-task_0001')).toBeTruthy());

    h.backend.length = 0;
    h.manager.emit('entityChanged', {
      typename: 'Task',
      id: 'task_0001',
      kind: 'DELETED',
      scope: 'tasks',
    });
    await waitFor(() => expect(view.queryByTestId('task-task_0001')).toBeNull());
    expect(h.client.cache.extract()['Task:task_0001']).toBeUndefined();
  });
});
