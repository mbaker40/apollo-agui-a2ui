import { useQuery } from '@apollo/client/react';
import { useEffect, useRef } from 'react';
import { TASKS_QUERY } from '../graphql/queries';

export function TaskList({ selectedTaskId }: { selectedTaskId: string | null }) {
  // refetchOn opts this watched query into entityChanged refetch events; the
  // agent's writes land here without any manual reload (see lib/reconcile.ts).
  const { data, loading, error } = useQuery(TASKS_QUERY, {
    refetchOn: { entityChanged: true },
  });
  const selectedRef = useRef<HTMLLIElement | null>(null);

  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedTaskId]);

  const tasks = data?.tasks ?? [];
  return (
    <section className="tasks" aria-label="Task list">
      <header>
        <h2>Tasks</h2>
        <span className="muted">{loading ? 'refreshing…' : `${tasks.length} total`}</span>
      </header>
      {error && <p className="error">GraphQL error: {error.message}</p>}
      {tasks.length === 0 && !loading && (
        <p className="muted empty">No tasks yet — ask the agent to “add a task to buy milk”.</p>
      )}
      <ul>
        {tasks.map((task) => (
          <li
            key={task.id}
            ref={task.id === selectedTaskId ? selectedRef : null}
            className={[
              task.completed ? 'completed' : '',
              task.id === selectedTaskId ? 'selected' : '',
            ].join(' ')}
            data-testid={`task-${task.id}`}
          >
            <span className="check" aria-hidden>
              {task.completed ? '✓' : '○'}
            </span>
            <span className="title">{task.title}</span>
            <span className="muted id">{task.id}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
