import type { Priority, Tag, Task } from './types.js';

interface TaskRecord {
  id: string;
  title: string;
  due: string | null;
  completed: boolean;
  priority: Priority;
  tagIds: string[];
  createdAt: string;
}

/**
 * The executor owns the datastore — in-memory for the MWE (the production
 * analogue is the true backend's real database). Ids are sequential and
 * deterministic so scripted e2e runs and recorded transcripts stay stable.
 * Tasks store tag ids; reads return tasks with tags embedded.
 */
export class DemoStore {
  private tasks = new Map<string, TaskRecord>();
  private tags = new Map<string, Tag>();
  private taskSeq = 0;
  private tagSeq = 0;

  // ── tasks ────────────────────────────────────────────────────────────────

  listTasks(): Task[] {
    return [...this.tasks.values()].map((t) => this.toTask(t));
  }

  getTask(id: string): Task | undefined {
    const record = this.tasks.get(id);
    return record && this.toTask(record);
  }

  createTask(input: { title: string; due?: string | null }): Task {
    this.taskSeq += 1;
    const record: TaskRecord = {
      id: `task_${String(this.taskSeq).padStart(4, '0')}`,
      title: input.title,
      due: input.due ?? null,
      completed: false,
      priority: 'MEDIUM',
      tagIds: [],
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(record.id, record);
    return this.toTask(record);
  }

  completeTask(id: string): Task | undefined {
    return this.patch(id, { completed: true });
  }

  reopenTask(id: string): Task | undefined {
    return this.patch(id, { completed: false });
  }

  renameTask(id: string, title: string): Task | undefined {
    return this.patch(id, { title });
  }

  setDue(id: string, due: string | null): Task | undefined {
    return this.patch(id, { due });
  }

  setPriority(id: string, priority: Priority): Task | undefined {
    return this.patch(id, { priority });
  }

  deleteTask(id: string): Task | undefined {
    const record = this.tasks.get(id);
    if (!record) return undefined;
    this.tasks.delete(id);
    return this.toTask(record);
  }

  duplicateTask(id: string): Task | undefined {
    const source = this.tasks.get(id);
    if (!source) return undefined;
    this.taskSeq += 1;
    const copy: TaskRecord = {
      ...source,
      id: `task_${String(this.taskSeq).padStart(4, '0')}`,
      title: `${source.title} (copy)`,
      completed: false,
      tagIds: [...source.tagIds],
      createdAt: new Date().toISOString(),
    };
    this.tasks.set(copy.id, copy);
    return this.toTask(copy);
  }

  clearCompleted(): Task[] {
    const removed: Task[] = [];
    for (const record of [...this.tasks.values()]) {
      if (record.completed) {
        this.tasks.delete(record.id);
        removed.push(this.toTask(record));
      }
    }
    return removed;
  }

  // ── tags ─────────────────────────────────────────────────────────────────

  listTags(): Tag[] {
    return [...this.tags.values()];
  }

  findTagByName(name: string): Tag | undefined {
    const lowered = name.toLowerCase();
    return [...this.tags.values()].find((t) => t.name.toLowerCase() === lowered);
  }

  /** Creates a tag; returns undefined when the (case-insensitive) name exists. */
  createTag(name: string): Tag | undefined {
    if (this.findTagByName(name)) return undefined;
    this.tagSeq += 1;
    const tag: Tag = {
      id: `tag_${String(this.tagSeq).padStart(4, '0')}`,
      name,
      createdAt: new Date().toISOString(),
    };
    this.tags.set(tag.id, tag);
    return tag;
  }

  /** Attaches a tag by name, auto-creating it if missing (idempotent per task). */
  tagTask(taskId: string, name: string): { task: Task; tag: Tag; tagCreated: boolean } | undefined {
    const record = this.tasks.get(taskId);
    if (!record) return undefined;
    const existing = this.findTagByName(name);
    const tag = existing ?? this.createTag(name)!;
    if (!record.tagIds.includes(tag.id)) record.tagIds.push(tag.id);
    return { task: this.toTask(record), tag, tagCreated: !existing };
  }

  // ── everything ───────────────────────────────────────────────────────────

  reset(): { deletedTaskIds: string[]; deletedTagIds: string[] } {
    const deletedTaskIds = [...this.tasks.keys()];
    const deletedTagIds = [...this.tags.keys()];
    this.tasks.clear();
    this.tags.clear();
    return { deletedTaskIds, deletedTagIds };
  }

  private patch(id: string, changes: Partial<TaskRecord>): Task | undefined {
    const record = this.tasks.get(id);
    if (!record) return undefined;
    const updated = { ...record, ...changes };
    this.tasks.set(id, updated);
    return this.toTask(updated);
  }

  private toTask(record: TaskRecord): Task {
    const { tagIds, ...rest } = record;
    return {
      ...rest,
      tags: tagIds.map((tagId) => this.tags.get(tagId)).filter((t): t is Tag => t !== undefined),
    };
  }
}
