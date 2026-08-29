import type { Message } from '@ag-ui/client';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import type { ChatController } from '../lib/agent';

function ToolChip({ name, args, done }: { name: string; args: string; done: boolean }) {
  let argText: string;
  try {
    const parsed = JSON.parse(args || '{}');
    argText = Object.values(parsed).filter(Boolean).join(', ');
  } catch {
    argText = args;
  }
  return (
    <span className={`chip ${done ? 'done' : 'pending'}`} data-testid={`chip-${name}`}>
      <span className="chip-dot" aria-hidden />
      {name}
      {argText ? `(${argText})` : '()'}
    </span>
  );
}

function MessageRow({ message, answered }: { message: Message; answered: Set<string> }) {
  if (message.role === 'user') {
    return (
      <div className="msg user">{typeof message.content === 'string' ? message.content : ''}</div>
    );
  }
  if (message.role === 'assistant') {
    const hasText = typeof message.content === 'string' && message.content.length > 0;
    const calls = message.toolCalls ?? [];
    if (!hasText && calls.length === 0) return null;
    return (
      <div className="msg assistant">
        {calls.map((call) => (
          <ToolChip
            key={call.id}
            name={call.function.name}
            args={call.function.arguments}
            done={answered.has(call.id)}
          />
        ))}
        {hasText && <p>{message.content as string}</p>}
      </div>
    );
  }
  return null; // tool results render as chip state, not as bubbles
}

export function Chat({ controller }: { controller: ChatController }) {
  const { messages, running, error } = useSyncExternalStore(
    controller.subscribe,
    controller.getSnapshot,
    controller.getSnapshot,
  );
  const [draft, setDraft] = useState('');
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const answered = new Set(
    messages.filter((m) => m.role === 'tool').map((m) => (m.role === 'tool' ? m.toolCallId : '')),
  );

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setDraft('');
    void controller.send(text);
  };

  return (
    <section className="chat" aria-label="Chat">
      <header>
        <h2>Agent chat</h2>
        <span className={`status ${running ? 'running' : ''}`}>
          {running ? 'thinking…' : 'idle'}
        </span>
      </header>
      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && (
          <p className="muted empty">
            Scripted phrases: “add a task to buy milk”, “I'm done with the milk one”, “open the milk
            task”.
          </p>
        )}
        {messages.map((message) => (
          <MessageRow key={message.id} message={message} answered={answered} />
        ))}
        {error && <div className="error">Run failed: {error}</div>}
      </div>
      <form onSubmit={submit}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Message the task agent…"
          aria-label="Chat message"
          disabled={running}
        />
        <button type="submit" disabled={running || !draft.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}
