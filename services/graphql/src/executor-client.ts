import { IDENTITY_HEADERS } from '@mwe/contracts';
import type { AuthedUser } from './auth.js';

export interface TaskDto {
  id: string;
  title: string;
  due: string | null;
  completed: boolean;
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
    method: 'GET' | 'POST',
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

  tasks(user: AuthedUser): Promise<TaskDto[]> {
    return this.call(user, 'graphql.tasks', 'GET', '/tasks');
  }

  createTask(user: AuthedUser, input: { title: string; due?: string | null }): Promise<TaskDto> {
    return this.call(user, 'graphql.createTask', 'POST', '/tasks', input);
  }

  completeTask(user: AuthedUser, id: string): Promise<TaskDto> {
    return this.call(
      user,
      'graphql.completeTask',
      'POST',
      `/tasks/${encodeURIComponent(id)}/complete`,
    );
  }
}
