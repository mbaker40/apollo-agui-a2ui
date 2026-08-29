/**
 * Chat controller over the raw @ag-ui/client HttpAgent (no CopilotKit):
 *
 * - streams runs and exposes a render snapshot via subscribe/getSnapshot
 *   (consumed with useSyncExternalStore),
 * - forwards CUSTOM `entity_changed` events into the Apollo refetch machinery,
 * - implements the frontend-tool loop from /contracts/frontend-tools.md:
 *   when a run finishes having called a registered frontend tool without a
 *   result, execute it locally, append the tool-result message, and start a
 *   continuation run — until the agent answers with text.
 */
import {
  AbstractAgent,
  HttpAgent,
  type AgentSubscriber,
  type Message,
  type Tool,
} from '@ag-ui/client';
import { ENTITY_CHANGED_EVENT, type EntityChangedPayload } from '@mwe/contracts';
import { isEntityChangedPayload } from './reconcile';

export interface FrontendTool {
  declaration: Tool;
  execute: (args: Record<string, unknown>) => Promise<unknown>;
}

export interface ChatSnapshot {
  messages: readonly Message[];
  running: boolean;
  error: string | null;
}

const MAX_CONTINUATIONS = 4;

export class ChatController {
  private listeners = new Set<() => void>();
  private snapshot: ChatSnapshot;
  private readonly tools: Map<string, FrontendTool>;

  constructor(
    private readonly agent: AbstractAgent,
    frontendTools: FrontendTool[],
    private readonly onEntityChanged: (payload: EntityChangedPayload) => void,
  ) {
    this.tools = new Map(frontendTools.map((t) => [t.declaration.name, t]));
    this.snapshot = { messages: [...agent.messages], running: false, error: null };
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ChatSnapshot => this.snapshot;

  private publish(partial: Partial<ChatSnapshot>): void {
    this.snapshot = {
      messages: [...this.agent.messages],
      running: this.snapshot.running,
      error: this.snapshot.error,
      ...partial,
    };
    for (const listener of this.listeners) listener();
  }

  async send(text: string): Promise<void> {
    if (this.snapshot.running || !text.trim()) return;
    this.agent.addMessage({
      id: `user_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: 'user',
      content: text,
    });
    this.publish({ running: true, error: null });

    const subscriber: AgentSubscriber = {
      onMessagesChanged: () => this.publish({}),
      onCustomEvent: ({ event }) => {
        if (event.name === ENTITY_CHANGED_EVENT && isEntityChangedPayload(event.value)) {
          this.onEntityChanged(event.value);
        }
      },
      onRunErrorEvent: ({ event }) => {
        this.publish({ error: event.message });
      },
    };

    try {
      for (let hop = 0; hop <= MAX_CONTINUATIONS; hop++) {
        await this.agent.runAgent(
          { tools: [...this.tools.values()].map((t) => t.declaration) },
          subscriber,
        );
        const pending = this.pendingFrontendCalls();
        if (pending.length === 0) break;
        for (const call of pending) {
          const result = await this.executeFrontendTool(call.name, call.args);
          this.agent.addMessage({
            id: `tool_${call.toolCallId}`,
            role: 'tool',
            toolCallId: call.toolCallId,
            content: JSON.stringify(result),
          });
        }
        this.publish({});
        // Loop: continuation run carries the tool results back to the agent.
      }
    } catch (err) {
      this.publish({ error: err instanceof Error ? err.message : String(err) });
    } finally {
      this.publish({ running: false });
    }
  }

  /** Tool calls made by the agent for registered frontend tools that have no tool-result message yet. */
  private pendingFrontendCalls(): {
    toolCallId: string;
    name: string;
    args: Record<string, unknown>;
  }[] {
    const answered = new Set(
      this.agent.messages.filter((m) => m.role === 'tool').map((m) => m.toolCallId),
    );
    const pending: { toolCallId: string; name: string; args: Record<string, unknown> }[] = [];
    for (const message of this.agent.messages) {
      if (message.role !== 'assistant' || !message.toolCalls) continue;
      for (const call of message.toolCalls) {
        if (!this.tools.has(call.function.name) || answered.has(call.id)) continue;
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(call.function.arguments || '{}');
        } catch {
          /* leave args empty */
        }
        pending.push({ toolCallId: call.id, name: call.function.name, args });
      }
    }
    return pending;
  }

  private async executeFrontendTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    const tool = this.tools.get(name);
    if (!tool) return { error: `frontend tool '${name}' is not registered` };
    try {
      return await tool.execute(args);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  }
}

export function createHttpChatController(options: {
  url: string;
  token: string;
  frontendTools: FrontendTool[];
  onEntityChanged: (payload: EntityChangedPayload) => void;
}): ChatController {
  const agent = new HttpAgent({
    url: options.url,
    headers: { authorization: `Bearer ${options.token}` },
  });
  return new ChatController(agent, options.frontendTools, options.onEntityChanged);
}
