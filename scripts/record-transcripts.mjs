#!/usr/bin/env node
/**
 * Records real AG-UI SSE transcripts from the live agent+executor stack into
 * contracts/fixtures/transcripts/. These are (a) the checked-in `curl -N`
 * proof that the agent streams the documented protocol, and (b) shared
 * fixtures replayed by the Kotlin and Swift chat-core tests.
 *
 * Deterministic: fresh executor store, fixed thread/run ids, stream delay 0.
 * Re-record any time with: node scripts/record-transcripts.mjs
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'contracts', 'fixtures', 'transcripts');
const EXECUTOR_PORT = 7490;
const AGENT_PORT = 7492;
const AGENT_URL = `http://127.0.0.1:${AGENT_PORT}/agui`;

const token = await new Promise((resolvePromise, reject) => {
  const child = spawn('node', [join(repoRoot, 'scripts', 'mint-dev-token.mjs')]);
  let out = '';
  child.stdout.on('data', (d) => (out += d));
  child.on('exit', (code) =>
    code === 0 ? resolvePromise(out.trim()) : reject(new Error('mint failed')),
  );
});

const children = [];
function spawnService(name, command, args, options) {
  // detached → own process group, so killGroup reaches the real service
  // behind wrapper processes like `npx` and `uv run`.
  const child = spawn(command, args, {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: true,
  });
  child.stdout.on('data', () => {});
  child.stderr.on('data', () => {});
  children.push(child);
  console.log(`started ${name} (pid ${child.pid})`);
  return child;
}

function killGroup(child, signal = 'SIGTERM') {
  try {
    process.kill(-child.pid, signal);
  } catch {
    /* already gone */
  }
}

async function waitForHealth(url, attempts = 60) {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`service at ${url} never became healthy`);
}

function runInput({ runId, text, messages, tools = [] }) {
  return {
    threadId: 'thread_rec',
    runId,
    state: null,
    messages: messages ?? [{ id: 'u1', role: 'user', content: text }],
    tools,
    context: [],
    forwardedProps: null,
  };
}

const OPEN_TASK_TOOL = {
  name: 'open_task',
  description:
    'Open the task with the given id in the client UI so the user can see it. Only call this when the current run declared it.',
  parameters: {
    type: 'object',
    additionalProperties: false,
    required: ['id'],
    properties: { id: { type: 'string', description: 'Id of the task to open' } },
  },
};

/** Run a seeding conversation without saving a fixture. */
async function play(body) {
  const res = await fetch(AGENT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`seed run failed with ${res.status}: ${await res.text()}`);
  await res.text();
}

async function record(file, body) {
  const res = await fetch(AGENT_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${file}: agent responded ${res.status}: ${await res.text()}`);
  const text = await res.text();
  writeFileSync(join(outDir, file), text, 'utf8');
  const eventCount = text.split('\n').filter((l) => l.startsWith('data: ')).length;
  console.log(`recorded ${file} (${eventCount} events)`);
  return text
    .split('\n')
    .filter((l) => l.startsWith('data: '))
    .map((l) => JSON.parse(l.slice('data: '.length)));
}

mkdirSync(outDir, { recursive: true });

// Fail fast if a stale stack is still bound — recording against leftover
// state would silently produce wrong fixtures.
for (const port of [EXECUTOR_PORT, AGENT_PORT]) {
  const busy = await fetch(`http://127.0.0.1:${port}/healthz`).then(
    () => true,
    () => false,
  );
  if (busy) throw new Error(`port ${port} is already in use — kill the stale service first`);
}

const executor = spawnService('executor', 'npx', ['tsx', 'src/main.ts'], {
  cwd: join(repoRoot, 'services', 'executor'),
  env: {
    ...process.env,
    EXECUTOR_PORT: String(EXECUTOR_PORT),
    EXECUTOR_DATA_DIR: mkdtempSync(join(tmpdir(), 'transcript-exec-')),
  },
});
await waitForHealth(`http://127.0.0.1:${EXECUTOR_PORT}/healthz`);

spawnService(
  'agent',
  'uv',
  ['run', 'uvicorn', 'agent.main:app', '--host', '127.0.0.1', '--port', String(AGENT_PORT)],
  {
    cwd: join(repoRoot, 'services', 'agent'),
    env: {
      ...process.env,
      EXECUTOR_URL: `http://127.0.0.1:${EXECUTOR_PORT}`,
      AGENT_STREAM_DELAY_MS: '0',
      AGENT_PORT: String(AGENT_PORT),
    },
  },
);
await waitForHealth(`http://127.0.0.1:${AGENT_PORT}/healthz`);

try {
  // 1. Backend write.
  await record('create_task.sse', runInput({ runId: 'run_rec_1', text: 'add a task to buy milk' }));

  // 2. Read-then-write against the task created in 1.
  await record(
    'complete_task.sse',
    runInput({ runId: 'run_rec_2', text: "I'm done with the milk one" }),
  );

  // 3. Frontend tool advertised → deferred open_task call ends the run.
  const deferred = await record(
    'open_task_deferred.sse',
    runInput({
      runId: 'run_rec_3',
      messages: [{ id: 'u1', role: 'user', content: 'open the milk task' }],
      tools: [OPEN_TASK_TOOL],
    }),
  );

  // 4. Continuation: replay exactly what a client's tool loop reconstructs
  //    from run 3's events, plus the locally-executed tool result.
  const toolCalls = deferred.filter((e) => e.type === 'TOOL_CALL_START');
  const listResult = deferred.find((e) => e.type === 'TOOL_CALL_RESULT');
  const [listCall, openCall] = toolCalls;
  const openArgs = deferred
    .filter((e) => e.type === 'TOOL_CALL_ARGS' && e.toolCallId === openCall.toolCallId)
    .map((e) => e.delta)
    .join('');
  await record(
    'open_task_continuation.sse',
    runInput({
      runId: 'run_rec_4',
      messages: [
        { id: 'u1', role: 'user', content: 'open the milk task' },
        {
          id: listCall.parentMessageId,
          role: 'assistant',
          toolCalls: [
            {
              id: listCall.toolCallId,
              type: 'function',
              function: { name: 'list_tasks', arguments: '{}' },
            },
          ],
        },
        {
          id: listResult.messageId,
          role: 'tool',
          toolCallId: listCall.toolCallId,
          content: listResult.content,
        },
        {
          id: openCall.parentMessageId,
          role: 'assistant',
          toolCalls: [
            {
              id: openCall.toolCallId,
              type: 'function',
              function: { name: 'open_task', arguments: openArgs },
            },
          ],
        },
        {
          id: 'client_tool_result_1',
          role: 'tool',
          toolCallId: openCall.toolCallId,
          content: JSON.stringify({ status: 'opened', id: JSON.parse(openArgs).id }),
        },
      ],
      tools: [OPEN_TASK_TOOL],
    }),
  );

  // 5. Same ask WITHOUT the capability → scripted model must not call the tool.
  await record(
    'capability_fallback.sse',
    runInput({ runId: 'run_rec_5', text: 'open the milk task' }),
  );

  // 6. Seed a second task (not saved as a fixture), then the v2 scenarios.
  await play(runInput({ runId: 'run_rec_6', text: 'add a task to call the vet' }));

  // 7. Cross-entity + cross-scope: tag_task auto-creates the tag →
  //    Task UPDATED (scope tasks) AND Tag CREATED (scope tags) in one run.
  await record(
    'tag_task.sse',
    runInput({ runId: 'run_rec_7', text: 'tag the vet task as urgent' }),
  );

  // 8. The DELETED kind finally has a producer.
  await record('delete_task.sse', runInput({ runId: 'run_rec_8', text: 'delete the vet task' }));

  // 9. Bulk: one entity_changed per removed task ("buy milk" was completed in 2).
  await record(
    'clear_completed.sse',
    runInput({ runId: 'run_rec_9', text: 'clear my completed tasks' }),
  );

  // 10. Executor down → RUN_ERROR.
  killGroup(executor);
  await new Promise((r) => setTimeout(r, 1000));
  await record(
    'run_error.sse',
    runInput({ runId: 'run_rec_10', text: 'add a task to call the vet' }),
  );

  console.log('all transcripts recorded');
} finally {
  // Disposable throwaway services — no graceful shutdown needed, and wrapper
  // processes (npx, uv run) don't reliably forward SIGTERM.
  for (const child of children) killGroup(child, 'SIGKILL');
}
process.exit(0);
