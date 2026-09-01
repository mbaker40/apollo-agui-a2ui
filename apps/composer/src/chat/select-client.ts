import { DEFAULT_MODEL, STORAGE_KEYS, readSetting } from '../lib/settings';
import { AnthropicChatClient } from './anthropic-client';
import type { LlmClient, LlmStreamEvent } from './llm-client';
import { RecordedLlmClient } from './recorded-client';

/** Selected when neither the recorded mock nor an Anthropic API key is set. */
export class UnconfiguredClient implements LlmClient {
  async *chatStream(): AsyncIterable<LlmStreamEvent> {
    yield {
      kind: 'error',
      message:
        'No LLM configured — add an Anthropic API key in Settings (gear icon), or enable the recorded mock (composerx.mockLlm=1).',
    };
  }
}

/**
 * Precedence: mock flag → RecordedLlmClient; API key in Settings →
 * AnthropicChatClient; else UnconfiguredClient.
 *
 * ChatPanel calls this on every send, so settings are read fresh from
 * localStorage here and passed as constructor args — key/model changes in
 * Settings take effect on the next message without a reload.
 */
export function selectLlmClient(): LlmClient {
  const mock = readSetting(STORAGE_KEYS.mockLlm) === '1' || import.meta.env.VITE_MOCK_LLM === '1';
  if (mock) return new RecordedLlmClient();
  const apiKey = readSetting(STORAGE_KEYS.apiKey);
  if (apiKey) {
    return new AnthropicChatClient({
      apiKey,
      model: readSetting(STORAGE_KEYS.model) ?? DEFAULT_MODEL,
    });
  }
  return new UnconfiguredClient();
}
