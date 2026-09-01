import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AnthropicChatClient } from '../src/chat/anthropic-client';
import type { LlmStreamEvent } from '../src/chat/llm-client';
import { RecordedLlmClient } from '../src/chat/recorded-client';
import { UnconfiguredClient, selectLlmClient } from '../src/chat/select-client';
import { DEFAULT_MODEL, STORAGE_KEYS } from '../src/lib/settings';

beforeEach(() => window.localStorage.clear());
afterEach(() => vi.unstubAllEnvs());

describe('selectLlmClient precedence', () => {
  it('returns UnconfiguredClient when neither mock nor key is set', () => {
    expect(selectLlmClient()).toBeInstanceOf(UnconfiguredClient);
  });

  it('returns AnthropicChatClient when an API key is stored (key beats unconfigured)', () => {
    window.localStorage.setItem(STORAGE_KEYS.apiKey, 'sk-ant-test');
    const client = selectLlmClient();
    expect(client).toBeInstanceOf(AnthropicChatClient);
    expect((client as AnthropicChatClient).apiKey).toBe('sk-ant-test');
    expect((client as AnthropicChatClient).model).toBe(DEFAULT_MODEL);
  });

  it('reads the stored model fresh on each selection', () => {
    window.localStorage.setItem(STORAGE_KEYS.apiKey, 'sk-ant-test');
    window.localStorage.setItem(STORAGE_KEYS.model, 'claude-sonnet-5');
    expect((selectLlmClient() as AnthropicChatClient).model).toBe('claude-sonnet-5');
    window.localStorage.setItem(STORAGE_KEYS.model, 'claude-haiku-4-5-20251001');
    expect((selectLlmClient() as AnthropicChatClient).model).toBe('claude-haiku-4-5-20251001');
  });

  it('mock flag beats a configured API key', () => {
    window.localStorage.setItem(STORAGE_KEYS.apiKey, 'sk-ant-test');
    window.localStorage.setItem(STORAGE_KEYS.mockLlm, '1');
    expect(selectLlmClient()).toBeInstanceOf(RecordedLlmClient);
  });

  it('VITE_MOCK_LLM=1 also selects the recorded mock', () => {
    window.localStorage.setItem(STORAGE_KEYS.apiKey, 'sk-ant-test');
    vi.stubEnv('VITE_MOCK_LLM', '1');
    expect(selectLlmClient()).toBeInstanceOf(RecordedLlmClient);
  });

  it('UnconfiguredClient points at Settings and the recorded mock', async () => {
    const events: LlmStreamEvent[] = [];
    for await (const event of new UnconfiguredClient().chatStream()) events.push(event);
    expect(events).toHaveLength(1);
    const only = events[0] as { kind: string; message: string };
    expect(only.kind).toBe('error');
    expect(only.message).toContain('Anthropic API key in Settings (gear icon)');
    expect(only.message).toContain('composerx.mockLlm=1');
  });
});
