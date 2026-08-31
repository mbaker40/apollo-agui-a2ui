/**
 * LLM chat seam (contract §8, verbatim). Agent C's AnthropicChatClient
 * implements this interface; the composer UI only ever talks to it.
 */
export interface LlmClient {
  chatStream(req: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): AsyncIterable<LlmStreamEvent>;
}

export type LlmStreamEvent =
  | { kind: 'text_delta'; text: string }
  | { kind: 'thinking_delta'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };
