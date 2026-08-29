/**
 * Boots the real stack — executor, graphql facade, agent — as child process
 * groups for the scripted-conversation scenarios, and tears them down after.
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AGENT_PORT, EXECUTOR_PORT, EXECUTOR_URL, GRAPHQL_PORT } from './stack.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

const children: ChildProcess[] = [];

function spawnService(command: string, args: string[], cwd: string, env: Record<string, string>) {
  const child = spawn(command, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ['ignore', 'ignore', 'inherit'],
    detached: true, // own process group → SIGKILL reaches services behind wrappers
  });
  children.push(child);
  return child;
}

async function waitForHealth(url: string, requireOk = true, attempts = 120): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const res = await fetch(url);
      // A non-2xx response still proves the server is up (e.g. the GraphQL
      // endpoint answers 400/405 to a bare GET).
      if (res.ok || !requireOk) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(`service at ${url} never became healthy`);
}

export default async function setup(): Promise<() => void> {
  for (const port of [EXECUTOR_PORT, GRAPHQL_PORT, AGENT_PORT]) {
    const busy = await fetch(`http://127.0.0.1:${port}/healthz`).then(
      () => true,
      () => false,
    );
    if (busy) throw new Error(`e2e port ${port} already in use — kill the stale service first`);
  }

  // pnpm keeps bins per-package (no hoisting): use each service's own tsx.
  const executorDir = join(repoRoot, 'services', 'executor');
  const graphqlDir = join(repoRoot, 'services', 'graphql');

  spawnService(join(executorDir, 'node_modules', '.bin', 'tsx'), ['src/main.ts'], executorDir, {
    EXECUTOR_PORT: String(EXECUTOR_PORT),
    EXECUTOR_DATA_DIR: mkdtempSync(join(tmpdir(), 'e2e-executor-')),
  });
  await waitForHealth(`${EXECUTOR_URL}/healthz`);

  spawnService(join(graphqlDir, 'node_modules', '.bin', 'tsx'), ['src/main.ts'], graphqlDir, {
    GRAPHQL_PORT: String(GRAPHQL_PORT),
    EXECUTOR_URL,
  });

  spawnService(
    'uv',
    ['run', 'uvicorn', 'agent.main:app', '--host', '127.0.0.1', '--port', String(AGENT_PORT)],
    join(repoRoot, 'services', 'agent'),
    {
      EXECUTOR_URL,
      AGENT_STREAM_DELAY_MS: '0',
    },
  );

  await waitForHealth(`http://127.0.0.1:${AGENT_PORT}/healthz`);
  // The GraphQL standalone server has no /healthz — any HTTP answer means up.
  await waitForHealth(`http://127.0.0.1:${GRAPHQL_PORT}/graphql`, false);

  return () => {
    for (const child of children) {
      if (child.pid) {
        try {
          process.kill(-child.pid, 'SIGKILL');
        } catch {
          /* already gone */
        }
      }
    }
  };
}
