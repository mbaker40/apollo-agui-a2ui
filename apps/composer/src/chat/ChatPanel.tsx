import { useEffect, useRef, useState } from 'react';
import { toRenderMessages } from '../lib/surface-doc';
import { useComposerState, useStore } from '../state/context';
import { extractLastJsonBlock } from './extract-json';
import type { LlmClient } from './llm-client';
import { selectLlmClient } from './select-client';
import { buildSystemPrompt } from './system-prompt';

interface ChatMessage {
  id: number;
  role: 'user' | 'assistant';
  content: string;
  thinking?: string;
  status?: 'streaming' | 'done' | 'stopped';
  applied?: boolean;
  applyError?: string;
  streamError?: string;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export function ChatPanel({ createClient = selectLlmClient }: { createClient?: () => LlmClient }) {
  const store = useStore();
  const state = useComposerState();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [streaming, setStreaming] = useState(false);
  const stopRef = useRef(false);
  const idRef = useRef(0);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [messages]);

  const updateMessage = (id: number, patch: Partial<ChatMessage>) => {
    setMessages((current) => current.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  };

  const send = async () => {
    const text = draft.trim();
    if (!text || streaming) return;
    setDraft('');
    const userMessage: ChatMessage = { id: ++idRef.current, role: 'user', content: text };
    const assistantId = ++idRef.current;
    const history = [...messages, userMessage];
    setMessages([
      ...history,
      { id: assistantId, role: 'assistant', content: '', status: 'streaming' },
    ]);
    setStreaming(true);
    stopRef.current = false;

    const client = createClient();
    const system = buildSystemPrompt({
      catalog: state.handshake.catalog,
      usages: state.handshake.usages,
      layoutJson: JSON.stringify(toRenderMessages(store.getState().doc), null, 2),
    });
    const requestMessages = history
      .filter((m) => m.content.length > 0)
      .map((m) => ({ role: m.role, content: m.content }));

    let content = '';
    let thinking = '';
    let streamError: string | undefined;
    try {
      for await (const event of client.chatStream({ system, messages: requestMessages })) {
        if (stopRef.current) break;
        if (event.kind === 'text_delta') {
          content += event.text;
          updateMessage(assistantId, { content });
        } else if (event.kind === 'thinking_delta') {
          thinking += event.text;
          updateMessage(assistantId, { thinking });
        } else if (event.kind === 'error') {
          streamError = event.message;
          break;
        } else if (event.kind === 'done') {
          break;
        }
      }
    } catch (err) {
      streamError = errorMessage(err);
    }

    let applied = false;
    let applyError: string | undefined;
    if (!streamError && !stopRef.current) {
      const block = extractLastJsonBlock(content);
      if (block !== null) {
        try {
          const result = store.actions.applyChatItems(JSON.parse(block));
          if (result.ok) applied = true;
          else applyError = result.error;
        } catch (err) {
          applyError = `Invalid JSON: ${errorMessage(err)}`;
        }
      }
    }
    updateMessage(assistantId, {
      status: stopRef.current ? 'stopped' : 'done',
      applied,
      applyError,
      streamError,
    });
    setStreaming(false);
  };

  return (
    <aside className="chat-panel" aria-label="Chat">
      <header className="pane-header">
        <h2>Chat</h2>
        <span className={`status-pill ${streaming ? 'busy' : ''}`}>
          {streaming ? 'streaming…' : 'idle'}
        </span>
      </header>
      <div className="chat-messages" ref={listRef}>
        {messages.length === 0 && (
          <p className="empty-note">
            Describe a layout ("a signup card with name and email fields") and the assistant replies
            with prose plus a JSON payload that is applied to the canvas. Without an Anthropic key,
            enable the recorded mock in settings.
          </p>
        )}
        {messages.map((m) =>
          m.role === 'user' ? (
            <div key={m.id} className="msg user">
              {m.content}
            </div>
          ) : (
            <div key={m.id} className="msg assistant" data-testid={`assistant-${m.id}`}>
              {m.thinking && (
                <details className="thinking">
                  <summary>Thinking</summary>
                  <pre>{m.thinking}</pre>
                </details>
              )}
              <div className="msg-content">
                {m.content || (m.status === 'streaming' ? '…' : '')}
              </div>
              <div className="msg-chips">
                {m.applied && (
                  <span className="chip ok" data-testid="chip-applied">
                    applied
                  </span>
                )}
                {m.applyError && (
                  <span className="chip err" data-testid="chip-apply-error">
                    {m.applyError}
                  </span>
                )}
                {m.streamError && (
                  <span className="chip err" data-testid="chip-stream-error">
                    {m.streamError}
                  </span>
                )}
                {m.status === 'stopped' && <span className="chip">stopped</span>}
              </div>
            </div>
          ),
        )}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          type="text"
          value={draft}
          disabled={streaming}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Ask for a layout…"
          aria-label="Chat message"
        />
        {streaming ? (
          <button
            type="button"
            onClick={() => {
              stopRef.current = true;
            }}
          >
            Stop
          </button>
        ) : (
          <button type="submit" disabled={draft.trim().length === 0}>
            Send
          </button>
        )}
      </form>
    </aside>
  );
}
