import type { Task } from './types.js';

/**
 * The executor owns the datastore — in-memory for the MWE (the production
 * analogue is the true backend's real database). Ids are sequential and
 * deterministic so scripted e2e runs and recorded transcripts stay stable.
 */
export class TaskStore {
  private tasks = new Map<string, Task>();
  private seq = 0;

  list(): Task[] {
    return [...this.tasks.values()];
  }

  get(id: string): Task | undefined {
    return this.tasks.get(id);
  }

  create(input: { title: string; due?: string | null }): Task {
    this.seq += 1;
    const task: Task = {
      id: `task_${String(this.seq).padStart(4, '0')}`,
      title: input.title,
      due: input.due ?? null,
      completed: false,
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(task.id, task);
    return task;
  }

  complete(id: string): Task | undefined {
    const task = this.tasks.get(id);
    if (!task) return undefined;
    const updated: Task = { ...task, completed: true };
    this.tasks.set(id, updated);
    return updated;
  }
}
