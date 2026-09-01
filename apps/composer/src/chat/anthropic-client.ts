/**
 * Real Anthropic LLM client behind the §8 seam (`LlmClient`).
 *
 * Architecture: requests go directly browser → api.anthropic.com with the
 * user's own key (`dangerouslyAllowBrowser: true` both lifts the SDK's
 * browser guard and sends the `anthropic-dangerous-direct-browser-access`
 * CORS opt-in header). No key ever ships in the bundle; select-client reads
 * it fresh from Settings on every send.
 *
 * Streaming: `client.messages.stream(...)` (SDK `MessageStream`), iterated as
 * raw `RawMessageStreamEvent`s and mapped onto the seam's `LlmStreamEvent`s.
 * The system prompt is sent as a single text block with
 * `cache_control: {type: 'ephemeral'}` so the large, stable catalog/usages
 * prefix caches across turns. Errors never escape the async iterable — they
 * become one `{kind: 'error'}` event with a friendly lead-in; when the
 * consumer stops iterating early, the underlying HTTP stream is aborted.
 */
import Anthropic, { APIConnectionError, APIError, APIUserAbortError } from '@anthropic-ai/sdk';
import type { MessageStream } from '@anthropic-ai/sdk/lib/MessageStream';
import type { LlmClient, LlmStreamEvent } from './llm-client';

type ChatRequest = Parameters<LlmClient['chatStream']>[0];

export interface AnthropicChatClientOptions {
  apiKey: string;
  model: string;
}

export const MAX_TOKENS = 16000;

/** Budget for the pre-adaptive thinking form (≥1024 and < MAX_TOKENS). */
export const LEGACY_THINKING_BUDGET_TOKENS = 4096;

/**
 * Extended thinking is always on. Current models take the adaptive form
 * (summarized display so the panel has text to show); the dated Haiku 4.5
 * picker entry predates adaptive thinking and still requires the
 * enabled+budget form (adaptive would be rejected with a 400).
 */
export function thinkingConfigFor(model: string): Anthropic.ThinkingConfigParam {
  if (model.startsWith('claude-haiku-4-5')) {
    return { type: 'enabled', budget_tokens: LEGACY_THINKING_BUDGET_TOKENS };
  }
  return { type: 'adaptive', display: 'summarized' };
}

/** Friendly lead-in per failure class, with the raw detail appended. */
export function friendlyErrorMessage(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  // Order matters: APIConnectionError extends APIError (status undefined).
  if (err instanceof APIConnectionError) {
    return `Network error talking to the Anthropic API — requests go directly from your browser to api.anthropic.com, so check your connection and anything that blocks cross-origin requests (ad blockers, VPNs, strict proxies). (${raw})`;
  }
  if (err instanceof APIError) {
    if (err.status === 401) {
      return `Authentication failed — check your Anthropic API key in Settings (gear icon). (${raw})`;
    }
    if (err.status === 429) {
      return `Rate limited by the Anthropic API — wait a moment and try again. (${raw})`;
    }
    return `Anthropic API error${err.status !== undefined ? ` (HTTP ${err.status})` : ''} — ${raw}`;
  }
  return `Chat stream failed — ${raw}`;
}

export class AnthropicChatClient implements LlmClient {
  readonly apiKey: string;
  readonly model: string;

  constructor(options: AnthropicChatClientOptions) {
    this.apiKey = options.apiKey;
    this.model = options.model;
  }

  async *chatStream(req: ChatRequest): AsyncIterable<LlmStreamEvent> {
    let stream: MessageStream | undefined;
    let failure: { reason: unknown } | null = null;
    try {
      const client = new Anthropic({ apiKey: this.apiKey, dangerouslyAllowBrowser: true });
      stream = client.messages.stream({
        model: this.model,
        max_tokens: MAX_TOKENS,
        system: [{ type: 'text', text: req.system, cache_control: { type: 'ephemeral' } }],
        messages: req.messages.map(({ role, content }) => ({ role, content })),
        thinking: thinkingConfigFor(this.model),
      });
      // A MessageStream error that fires while no read is pending ends the
      // iteration without rejecting it — capture it so it still surfaces.
      stream.on('error', (err) => {
        failure ??= { reason: err };
      });
      for await (const event of stream) {
        if (event.type !== 'content_block_delta') continue;
        if (event.delta.type === 'text_delta') {
          yield { kind: 'text_delta', text: event.delta.text };
        } else if (event.delta.type === 'thinking_delta') {
          // Adaptive thinking with display 'summarized' streams the summary
          // through the same thinking_delta events.
          yield { kind: 'thinking_delta', text: event.delta.thinking };
        }
      }
    } catch (err) {
      failure ??= { reason: err };
    } finally {
      // Runs on normal completion (no-op by then) and — critically — when the
      // consumer stops iterating early: abort the underlying HTTP stream.
      stream?.abort();
    }
    if (failure !== null) {
      const { reason } = failure;
      // Our own cancellation surfacing back — nobody is listening; just end.
      if (reason instanceof APIUserAbortError) return;
      yield { kind: 'error', message: friendlyErrorMessage(reason) };
      return;
    }
    yield { kind: 'done' };
  }
}
