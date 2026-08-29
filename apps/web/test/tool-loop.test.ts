/**
 * The frontend-tool loop, driven by the SAME recorded SSE transcripts the
 * mobile cores replay (contracts/fixtures/transcripts). A scripted agent
 * plays back run N's events; the controller must execute open_task locally,
 * append the tool-result message, and start the continuation run.
 */
import { AbstractAgent, type BaseEvent, type RunAgentInput } from '@ag-ui/client';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { from, type Observable } from 'rxjs';
import { describe, expect, it, vi } from 'vitest';
import { OPEN_TASK_TOOL } from '@mwe/contracts';
import { ChatController } from '../src/lib/agent';

const transcriptsDir = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../contracts/fixtures/transcripts',
);

function loadTranscript(name: string): BaseEvent[] {
  return readFileSync(join(transcriptsDir, name), 'utf8')
    .split('\n')
    .filter((line) => line.startsWith('data: '))
    .map((line) => JSON.parse(line.slice('data: '.length)) as BaseEvent);
}

class ScriptedAgent extends AbstractAgent {
  inputs: RunAgentInput[] = [];

  constructor(private script: BaseEvent[][]) {
    super();
  }

  run(input: RunAgentInput): Observable<BaseEvent> {
    this.inputs.push(input);
    const events = this.script.shift() ?? [];
    // Recorded transcripts carry their original run ids; rebind them to this
    // run's ids so the client pipeline sees a consistent stream.
    const rebound = events.map((event) => {
      const e = event as BaseEvent & { runId?: string; threadId?: string };
      if (e.runId !== undefined || e.threadId !== undefined) {
        return { ...e, runId: input.runId, threadId: input.threadId };
      }
      return event;
    });
    return from(rebound);
  }
}

describe('web frontend-tool loop (recorded transcripts)', () => {
  it('executes open_task locally and continues the run with the result', async () => {
    const agent = new ScriptedAgent([
      loadTranscript('open_task_deferred.sse'),
      loadTranscript('open_task_continuation.sse'),
    ]);
    const execute = vi.fn(async (args: Record<string, unknown>) => ({
      status: 'opened',
      id: String(args.id),
    }));
    const onEntityChanged = vi.fn();
    const controller = new ChatController(
      agent,
      [{ declaration: OPEN_TASK_TOOL, execute }],
      onEntityChanged,
    );

    await controller.send('open the milk task');

    // Tool executed exactly once, with the args the agent streamed.
    expect(execute).toHaveBeenCalledTimes(1);
    expect(execute).toHaveBeenCalledWith({ id: 'task_0001' });

    // Two runs: the deferred run + the continuation carrying the tool result.
    expect(agent.inputs).toHaveLength(2);
    const continuation = agent.inputs[1]!;
    const toolMessages = continuation.messages.filter((m) => m.role === 'tool');
    expect(toolMessages.some((m) => m.content === '{"status":"opened","id":"task_0001"}')).toBe(
      true,
    );
    // Both runs declared the tool (capability-aware runs).
    expect(continuation.tools.map((t) => t.name)).toEqual(['open_task']);

    // Final assistant message reflects the client-side result.
    const snapshot = controller.getSnapshot();
    const lastAssistant = [...snapshot.messages]
      .reverse()
      .find((m) => m.role === 'assistant' && typeof m.content === 'string' && m.content.length > 0);
    expect(lastAssistant?.content).toBe('Opened "buy milk" for you.');
    expect(snapshot.running).toBe(false);
    expect(snapshot.error).toBeNull();
    expect(onEntityChanged).not.toHaveBeenCalled();
  });

  it('forwards entity_changed CUSTOM events into the reconciler', async () => {
    const agent = new ScriptedAgent([loadTranscript('create_task.sse')]);
    const onEntityChanged = vi.fn();
    const controller = new ChatController(agent, [], onEntityChanged);

    await controller.send('add a task to buy milk');

    expect(onEntityChanged).toHaveBeenCalledExactlyOnceWith({
      typename: 'Task',
      id: 'task_0001',
      kind: 'CREATED',
      scope: 'tasks',
    });
    const lastAssistant = [...controller.getSnapshot().messages]
      .reverse()
      .find((m) => m.role === 'assistant' && typeof m.content === 'string');
    expect(lastAssistant?.content).toBe('Created "buy milk" (task_0001). Anything else?');
  });

  it('surfaces RUN_ERROR as a chat error state', async () => {
    const agent = new ScriptedAgent([loadTranscript('run_error.sse')]);
    const controller = new ChatController(agent, [], vi.fn());

    await controller.send('add a task to call the vet');

    const snapshot = controller.getSnapshot();
    expect(snapshot.error).toContain('executor unreachable');
    expect(snapshot.running).toBe(false);
  });
});
