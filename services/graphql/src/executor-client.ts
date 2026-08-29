import { IDENTITY_HEADERS } from '@mwe/contracts';
import type { AuthedUser } from './auth.js';

export interface TagDto {
  id: string;
  name: string;
  createdAt: string;
}

export interface TaskDto {
  id: string;
  title: string;
  due: string | null;
  completed: boolean;
  priority: 'LOW' | 'MEDIUM' | 'HIGH';
  tags: TagDto[];
  createdAt: string;
}

/**
 * The facade's ONLY data source is the executor's REST API — it has no
 * database access of its own. Each GraphQL operation maps to one allowlisted
 * executor tool name (see /contracts/identity-headers.md).
 */
export class ExecutorClient {
  constructor(private readonly baseUrl: string) {}

  private async call<T>(
    user: AuthedUser,
    toolName: string,
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
    const headers: Record<string, string> = {
      [IDENTITY_HEADERS.callerService]: 'graphql',
      [IDENTITY_HEADERS.userId]: user.sub,
      [IDENTITY_HEADERS.toolName]: toolName,
    };
    if (user.email) headers[IDENTITY_HEADERS.userEmail] = user.email;
    if (body !== undefined) headers['content-type'] = 'application/json';

    const res = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      const detail = await res.text();
      throw new Error(`executor ${method} ${path} failed with ${res.status}: ${detail}`);
    }
    return (await res.json()) as T;
  }

  private task(
    user: AuthedUser,
    tool: string,
    method: 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ) {
    return this.call<TaskDto>(user, tool, method, path, body);
  }

  tasks(user: AuthedUser): Promise<TaskDto[]> {
    return this.call(user, 'graphql.tasks', 'GET', '/tasks');
  }

  tags(user: AuthedUser): Promise<TagDto[]> {
    return this.call(user, 'graphql.tags', 'GET', '/tags');
  }

  createTask(user: AuthedUser, input: { title: string; due?: string | null }): Promise<TaskDto> {
    return this.task(user, 'graphql.createTask', 'POST', '/tasks', input);
  }

  completeTask(user: AuthedUser, id: string): Promise<TaskDto> {
    return this.task(
      user,
      'graphql.completeTask',
      'POST',
      `/tasks/${encodeURIComponent(id)}/complete`,
    );
  }

  renameTask(user: AuthedUser, id: string, title: string): Promise<TaskDto> {
    return this.task(
      user,
      'graphql.renameTask',
      'POST',
      `/tasks/${encodeURIComponent(id)}/rename`,
      {
        title,
      },
    );
  }

  setDue(user: AuthedUser, id: string, due: string | null): Promise<TaskDto> {
    return this.task(user, 'graphql.setDue', 'POST', `/tasks/${encodeURIComponent(id)}/due`, {
      due,
    });
  }

  setPriority(user: AuthedUser, id: string, priority: string): Promise<TaskDto> {
    return this.task(
      user,
      'graphql.setPriority',
      'POST',
      `/tasks/${encodeURIComponent(id)}/priority`,
      {
        priority,
      },
    );
  }

  reopenTask(user: AuthedUser, id: string): Promise<TaskDto> {
    return this.task(user, 'graphql.reopenTask', 'POST', `/tasks/${encodeURIComponent(id)}/reopen`);
  }

  deleteTask(user: AuthedUser, id: string): Promise<TaskDto> {
    return this.task(user, 'graphql.deleteTask', 'DELETE', `/tasks/${encodeURIComponent(id)}`);
  }

  duplicateTask(user: AuthedUser, id: string): Promise<TaskDto> {
    return this.task(
      user,
      'graphql.duplicateTask',
      'POST',
      `/tasks/${encodeURIComponent(id)}/duplicate`,
    );
  }

  clearCompleted(user: AuthedUser): Promise<{ deleted: TaskDto[] }> {
    return this.call(user, 'graphql.clearCompleted', 'POST', '/tasks/completed/clear');
  }

  createTag(user: AuthedUser, name: string): Promise<TagDto> {
    return this.call(user, 'graphql.createTag', 'POST', '/tags', { name });
  }

  tagTask(
    user: AuthedUser,
    id: string,
    name: string,
  ): Promise<{ task: TaskDto; tag: TagDto; tagCreated: boolean }> {
    return this.call(user, 'graphql.tagTask', 'POST', `/tasks/${encodeURIComponent(id)}/tags`, {
      name,
    });
  }

  resetDemo(user: AuthedUser): Promise<{ deletedTaskIds: string[]; deletedTagIds: string[] }> {
    return this.call(user, 'graphql.resetDemo', 'POST', '/admin/reset');
  }
}
