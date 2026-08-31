import { useQuery } from '@apollo/client/react';
import { useEffect, useRef } from 'react';
import { TAGS_QUERY, TASKS_QUERY } from '../graphql/queries';

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
            {task.priority !== 'MEDIUM' && (
              <span className={`badge priority-${task.priority.toLowerCase()}`}>
                {task.priority.toLowerCase()}
              </span>
            )}
            {task.due && <span className="badge due">due {task.due}</span>}
            {task.tags.map((tag) => (
              <span key={tag.id} className="badge tag">
                #{tag.name}
              </span>
            ))}
            <span className="muted id">{task.id}</span>
          </li>
        ))}
      </ul>
      <TagsStrip />
    </section>
  );
}

/** Second reconciliation scope made visible: Tag CREATED/DELETED events
 * refetch this watched query via the Tag → ['tags'] registry entry. */
export function TagsStrip() {
  const { data } = useQuery(TAGS_QUERY, {
    refetchOn: { entityChanged: true },
  });
  const tags = data?.tags ?? [];
  if (tags.length === 0) return null;
  return (
    <footer className="tags-strip" aria-label="Tags">
      <span className="muted">tags:</span>
      {tags.map((tag) => (
        <span key={tag.id} className="badge tag" data-testid={`tag-${tag.id}`}>
          #{tag.name}
        </span>
      ))}
    </footer>
  );
}
