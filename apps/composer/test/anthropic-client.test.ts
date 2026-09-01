/**
 * AnthropicChatClient against a scripted fake of `@anthropic-ai/sdk`.
 * The mock replaces only the default export (the Anthropic client class);
 * the real error classes are kept so instanceof-based mapping is exercised
 * exactly as in production.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APIConnectionError, APIError } from '@anthropic-ai/sdk';
import {
  AnthropicChatClient,
  LEGACY_THINKING_BUDGET_TOKENS,
  MAX_TOKENS,
  friendlyErrorMessage,
} from '../src/chat/anthropic-client';
import type { LlmStreamEvent } from '../src/chat/llm-client';

type Step =
  | { kind: 'event'; event: unknown }
  | { kind: 'throw'; error: unknown }
  | { kind: 'emit-error-end'; error: unknown };

const harness = vi.hoisted(() => {
  type HoistedStep =
    | { kind: 'event'; event: unknown }
    | { kind: 'throw'; error: unknown }
    | { kind: 'emit-error-end'; error: unknown };

  class FakeMessageStream {
    aborted = false;
    abortCalls = 0;
    private errorListeners: ((err: unknown) => void)[] = [];

    constructor(private readonly steps: HoistedStep[]) {}

    on(event: string, listener: (err: unknown) => void): this {
      if (event === 'error') this.errorListeners.push(listener);
      return this;
    }

    abort(): void {
      this.abortCalls += 1;
      this.aborted = true;
    }

    [Symbol.asyncIterator](): AsyncIterator<unknown> {
      let i = 0;
      let done = false;
      return {
        next: async () => {
          if (done || this.aborted) return { value: undefined, done: true };
          const step = this.steps[i++];
          if (!step) {
            done = true;
            return { value: undefined, done: true };
          }
          if (step.kind === 'throw') {
            // Real MessageStream: #handleError emits 'error', pending reads reject.
            done = true;
            for (const listener of this.errorListeners) listener(step.error);
            throw step.error;
          }
          if (step.kind === 'emit-error-end') {
            // Real MessageStream edge: 'error' fires while no read is pending —
            // the iteration just ends (done: true) without rejecting.
            done = true;
            for (const listener of this.errorListeners) listener(step.error);
            return { value: undefined, done: true };
          }
          return { value: step.event, done: false };
        },
        return: async () => {
          // Mirrors the real iterator: breaking a for-await aborts the stream.
          this.abort();
          done = true;
          return { value: undefined, done: true };
        },
      };
    }
  }

  const calls = {
    clientOptions: [] as unknown[],
    streamParams: [] as unknown[],
    streams: [] as InstanceType<typeof FakeMessageStream>[],
  };
  let nextSteps: HoistedStep[] = [];

  class FakeAnthropic {
    messages = {
      stream: (params: unknown) => {
        calls.streamParams.push(params);
        const stream = new FakeMessageStream(nextSteps);
        calls.streams.push(stream);
        return stream;
      },
    };

    constructor(options: unknown) {
      calls.clientOptions.push(options);
    }
  }

  return {
    FakeAnthropic,
    calls,
    setSteps(steps: HoistedStep[]) {
      nextSteps = steps;
    },
    reset() {
      calls.clientOptions.length = 0;
      calls.streamParams.length = 0;
      calls.streams.length = 0;
      nextSteps = [];
    },
  };
});

vi.mock('@anthropic-ai/sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@anthropic-ai/sdk')>();
  return { ...actual, default: harness.FakeAnthropic };
});

const ev = (event: unknown): Step => ({ kind: 'event', event });
const textDelta = (text: string) =>
  ev({ type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text } });
const thinkingDelta = (thinking: string) =>
  ev({ type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking } });

function auth401(): APIError {
  return APIError.generate(
    401,
    { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } },
    undefined,
    new Headers(),
  );
}

const request = {
  system: 'SYSTEM PROMPT with catalog + usages',
  messages: [
    { role: 'user' as const, content: 'make a card' },
    { role: 'assistant' as const, content: 'done' },
    { role: 'user' as const, content: 'now add a button' },
  ],
};

async function collect(client: AnthropicChatClient): Promise<LlmStreamEvent[]> {
  const events: LlmStreamEvent[] = [];
  for await (const event of client.chatStream(request)) events.push(event);
  return events;
}

beforeEach(() => harness.reset());
afterEach(() => vi.clearAllMocks());

describe('AnthropicChatClient event mapping', () => {
  it('maps thinking/text deltas in order and ends with done', async () => {
    harness.setSteps([
      ev({ type: 'message_start', message: { type: 'message' } }),
      ev({ type: 'content_block_start', index: 0, content_block: { type: 'thinking' } }),
      thinkingDelta('Sketching the layout — '),
      thinkingDelta('a Card with a Button.'),
      ev({
        type: 'content_block_delta',
        index: 0,
        delta: { type: 'signature_delta', signature: 'sig' },
      }),
      ev({ type: 'content_block_stop', index: 0 }),
      ev({ type: 'content_block_start', index: 1, content_block: { type: 'text', text: '' } }),
      textDelta('Here is '),
      textDelta('the card.'),
      ev({ type: 'content_block_stop', index: 1 }),
      ev({ type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: {} }),
      ev({ type: 'message_stop' }),
    ]);
    const client = new AnthropicChatClient({ apiKey: 'sk-test', model: 'claude-opus-5' });
    const events = await collect(client);
    expect(events).toEqual([
      { kind: 'thinking_delta', text: 'Sketching the layout — ' },
      { kind: 'thinking_delta', text: 'a Card with a Button.' },
      { kind: 'text_delta', text: 'Here is ' },
      { kind: 'text_delta', text: 'the card.' },
      { kind: 'done' },
    ]);
  });

  it('passes model/apiKey through and sends a cache_control system block + adaptive thinking', async () => {
    harness.setSteps([textDelta('ok'), ev({ type: 'message_stop' })]);
    const client = new AnthropicChatClient({ apiKey: 'sk-test-123', model: 'claude-opus-5' });
    await collect(client);

    expect(harness.calls.clientOptions).toEqual([
      { apiKey: 'sk-test-123', dangerouslyAllowBrowser: true },
    ]);
    expect(harness.calls.streamParams).toHaveLength(1);
    const params = harness.calls.streamParams[0] as Record<string, unknown>;
    expect(params.model).toBe('claude-opus-5');
    expect(params.max_tokens).toBe(MAX_TOKENS);
    expect(params.system).toEqual([
      { type: 'text', text: request.system, cache_control: { type: 'ephemeral' } },
    ]);
    expect(params.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
    expect(params.messages).toEqual(request.messages);
  });

  it('uses the enabled+budget thinking form for the dated Haiku 4.5 model', async () => {
    harness.setSteps([ev({ type: 'message_stop' })]);
    const client = new AnthropicChatClient({
      apiKey: 'sk-test',
      model: 'claude-haiku-4-5-20251001',
    });
    await collect(client);
    const params = harness.calls.streamParams[0] as Record<string, unknown>;
    expect(params.thinking).toEqual({
      type: 'enabled',
      budget_tokens: LEGACY_THINKING_BUDGET_TOKENS,
    });
  });
});

describe('AnthropicChatClient errors', () => {
  it('maps a mid-stream 401 to one friendly auth error event, then ends', async () => {
    harness.setSteps([textDelta('partial '), { kind: 'throw', error: auth401() }]);
    const client = new AnthropicChatClient({ apiKey: 'sk-bad', model: 'claude-opus-5' });
    const events = await collect(client);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ kind: 'text_delta', text: 'partial ' });
    const last = events[1] as { kind: string; message: string };
    expect(last.kind).toBe('error');
    expect(last.message).toContain('check your Anthropic API key in Settings');
    // raw detail is appended after the friendly lead-in
    expect(last.message).toContain('invalid x-api-key');
    expect(events.filter((e) => e.kind === 'error')).toHaveLength(1);
    expect(events.some((e) => e.kind === 'done')).toBe(false);
  });

  it('surfaces an error event that fires while no read is pending', async () => {
    harness.setSteps([textDelta('a'), { kind: 'emit-error-end', error: auth401() }]);
    const client = new AnthropicChatClient({ apiKey: 'sk-bad', model: 'claude-opus-5' });
    const events = await collect(client);
    expect(events.map((e) => e.kind)).toEqual(['text_delta', 'error']);
    expect((events[1] as { message: string }).message).toContain(
      'check your Anthropic API key in Settings',
    );
  });

  it('friendlyErrorMessage maps 429, connection failures, and unknown errors', () => {
    const rateLimited = APIError.generate(
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'rate limited' } },
      undefined,
      new Headers(),
    );
    expect(friendlyErrorMessage(rateLimited)).toContain('Rate limited by the Anthropic API');
    expect(friendlyErrorMessage(rateLimited)).toContain('rate limited');

    const network = new APIConnectionError({ message: 'Connection error.' });
    const networkMessage = friendlyErrorMessage(network);
    expect(networkMessage).toContain('directly from your browser to api.anthropic.com');
    expect(networkMessage).toContain('Connection error.');

    expect(friendlyErrorMessage(new Error('boom'))).toContain('Chat stream failed');
    expect(friendlyErrorMessage(new Error('boom'))).toContain('boom');
  });
});

describe('AnthropicChatClient cancellation', () => {
  it('aborts the SDK stream when the consumer breaks out of the for-await', async () => {
    harness.setSteps([textDelta('one'), textDelta('two'), textDelta('three')]);
    const client = new AnthropicChatClient({ apiKey: 'sk-test', model: 'claude-opus-5' });
    for await (const event of client.chatStream(request)) {
      expect(event).toEqual({ kind: 'text_delta', text: 'one' });
      break; // ChatPanel's Stop button path
    }
    const stream = harness.calls.streams[0]!;
    expect(stream.aborted).toBe(true);
    expect(stream.abortCalls).toBeGreaterThanOrEqual(1);
  });
});
