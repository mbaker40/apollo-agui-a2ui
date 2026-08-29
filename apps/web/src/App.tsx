import { OPEN_TASK_TOOL, type OpenTaskResult } from '@mwe/contracts';
import { useMemo, useState } from 'react';
import { Chat } from './components/Chat';
import { TaskList } from './components/TaskList';
import { AGENT_URL, DEV_JWT } from './config';
import { apolloClient, refetchEvents } from './graphql/client';
import { TASKS_QUERY } from './graphql/queries';
import { createHttpChatController } from './lib/agent';

export default function App() {
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const controller = useMemo(
    () =>
      createHttpChatController({
        url: AGENT_URL,
        token: DEV_JWT,
        // The hybrid half: open_task is executed HERE, in the client. The
        // declaration comes verbatim from /contracts (conformance-tested).
        frontendTools: [
          {
            declaration: OPEN_TASK_TOOL,
            execute: async (args): Promise<OpenTaskResult> => {
              const id = String(args.id ?? '');
              const cached = apolloClient.readQuery({ query: TASKS_QUERY });
              const exists = cached?.tasks.some((t) => t.id === id) ?? false;
              if (!exists) return { status: 'not_found', id };
              setSelectedTaskId(id);
              return { status: 'opened', id };
            },
          },
        ],
        onEntityChanged: (payload) => refetchEvents.emit('entityChanged', payload),
      }),
    [],
  );

  return (
    <main>
      <h1>
        Hybrid chat-action MWE
        <span className="muted"> — AG-UI chat + Apollo GraphQL, reconciled by events</span>
      </h1>
      <div className="panes">
        <Chat controller={controller} />
        <TaskList selectedTaskId={selectedTaskId} />
      </div>
    </main>
  );
}
