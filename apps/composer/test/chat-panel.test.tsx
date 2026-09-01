import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { ChatPanel } from '../src/chat/ChatPanel';
import type { LlmClient, LlmStreamEvent } from '../src/chat/llm-client';
import { RecordedLlmClient } from '../src/chat/recorded-client';
import { UnconfiguredClient } from '../src/chat/select-client';
import { StoreProvider } from '../src/state/context';
import { createComposerStore } from '../src/state/store';

function setup(createClient?: () => LlmClient) {
  const store = createComposerStore();
  store.attachPort({ sendRender: () => {}, sendTheme: () => {} });
  render(
    <StoreProvider store={store}>
      <ChatPanel createClient={createClient} />
    </StoreProvider>,
  );
  return { store };
}

function sendMessage(text: string) {
  fireEvent.change(screen.getByLabelText('Chat message'), { target: { value: text } });
  fireEvent.click(screen.getByRole('button', { name: 'Send' }));
}

beforeEach(() => window.localStorage.clear());
afterEach(() => cleanup());

describe('ChatPanel with the recorded client', () => {
  it('streams the recorded reply, applies the JSON, and shows the applied chip', async () => {
    const { store } = setup(() => new RecordedLlmClient(1));
    sendMessage('make me a card');
    expect(screen.getByText('make me a card')).toBeTruthy();
    // input disabled + stop button while streaming
    expect((screen.getByLabelText('Chat message') as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();

    await waitFor(() => expect(screen.getByTestId('chip-applied')).toBeTruthy(), {
      timeout: 3000,
    });
    // the recorded payload replaced the welcome layout with Card + Text
    const doc = store.getState().doc;
    expect(doc.components.some((c) => c.component === 'Card')).toBe(true);
    expect(doc.components.some((c) => c.id === 'card-title-g1')).toBe(true);
    // undo-able chat apply
    expect(store.getState().undoStack.length).toBe(1);
    // thinking disclosure rendered (collapsed by default)
    const thinking = document.querySelector('details.thinking');
    expect(thinking).toBeTruthy();
    expect((thinking as HTMLDetailsElement).open).toBe(false);
    // input usable again
    expect((screen.getByLabelText('Chat message') as HTMLInputElement).disabled).toBe(false);
    expect(screen.getByRole('button', { name: 'Send' })).toBeTruthy();
  });

  it('selects the recorded client via localStorage composerx.mockLlm=1', async () => {
    window.localStorage.setItem('composerx.mockLlm', '1');
    const { store } = setup(); // default createClient = selectLlmClient
    sendMessage('go');
    await waitFor(() => expect(screen.getByTestId('chip-applied')).toBeTruthy(), {
      timeout: 5000,
    });
    expect(store.getState().doc.components.some((c) => c.component === 'Card')).toBe(true);
  });
});

describe('ChatPanel error paths', () => {
  it('shows the unconfigured-client error when no mock is enabled', async () => {
    setup(() => new UnconfiguredClient());
    sendMessage('hello');
    await waitFor(() => expect(screen.getByTestId('chip-stream-error')).toBeTruthy());
    expect(screen.getByTestId('chip-stream-error').textContent).toBe(
      'No LLM configured — add an Anthropic API key in Settings (gear icon), or enable the recorded mock (composerx.mockLlm=1).',
    );
  });

  it('shows a parse-error chip when the reply JSON does not validate', async () => {
    const badClient: LlmClient = {
      async *chatStream(): AsyncIterable<LlmStreamEvent> {
        yield { kind: 'text_delta', text: 'Sure!\n```json\n{"not": "an array"}\n```\n' };
        yield { kind: 'done' };
      },
    };
    const { store } = setup(() => badClient);
    const before = store.getState().doc;
    sendMessage('break please');
    await waitFor(() => expect(screen.getByTestId('chip-apply-error')).toBeTruthy());
    expect(screen.getByTestId('chip-apply-error').textContent).toMatch(/array/);
    expect(store.getState().doc).toBe(before);
    expect(screen.queryByTestId('chip-applied')).toBeNull();
  });

  it('adds no chip when the reply has no fenced JSON at all', async () => {
    const proseClient: LlmClient = {
      async *chatStream(): AsyncIterable<LlmStreamEvent> {
        yield { kind: 'text_delta', text: 'Just words, no payload.' };
        yield { kind: 'done' };
      },
    };
    setup(() => proseClient);
    sendMessage('chat only');
    await waitFor(() => expect(screen.getByText('Just words, no payload.')).toBeTruthy());
    await waitFor(() =>
      expect((screen.getByLabelText('Chat message') as HTMLInputElement).disabled).toBe(false),
    );
    expect(screen.queryByTestId('chip-applied')).toBeNull();
    expect(screen.queryByTestId('chip-apply-error')).toBeNull();
  });
});
