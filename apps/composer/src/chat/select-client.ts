import { STORAGE_KEYS, readSetting } from '../lib/settings';
import type { LlmClient, LlmStreamEvent } from './llm-client';
import { RecordedLlmClient } from './recorded-client';

/** Placeholder until agent C lands the AnthropicChatClient (contract §8). */
export class UnconfiguredClient implements LlmClient {
  async *chatStream(): AsyncIterable<LlmStreamEvent> {
    yield {
      kind: 'error',
      message: 'Anthropic client not yet wired — set composerx.mockLlm=1 for the recorded client',
    };
  }
}

export function selectLlmClient(): LlmClient {
  const mock = readSetting(STORAGE_KEYS.mockLlm) === '1' || import.meta.env.VITE_MOCK_LLM === '1';
  if (mock) return new RecordedLlmClient();
  return new UnconfiguredClient();
}
