/**
 * Deterministic scripted LlmClient for keyless demos and tests
 * (`composerx.mockLlm=1` / `VITE_MOCK_LLM=1`). The reply's JSON payload is
 * built with the real surface-doc helpers so it always parses and applies.
 */
import type { RenderA2uiItem } from 'a2ui-bridge/messages';
import { emptyDoc, insertUsage, toRenderMessages } from '../lib/surface-doc';
import type { LlmClient, LlmStreamEvent } from './llm-client';

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** A Card with a Text child added to an empty root, via the real insert op. */
export function recordedRenderItems(): RenderA2uiItem[] {
  const doc = insertUsage(
    emptyDoc(),
    {
      usage: [
        { id: 'root', component: 'Card', child: 'card-body' },
        { id: 'card-body', component: 'Column', children: ['card-title', 'card-text'] },
        {
          id: 'card-title',
          component: 'Text',
          text: 'Hello from the recorded model',
          variant: 'h3',
        },
        {
          id: 'card-text',
          component: 'Text',
          text: 'This layout came from the deterministic mock stream.',
        },
      ],
    },
    { containerId: 'root' },
  );
  return toRenderMessages(doc);
}

function recordedEvents(): LlmStreamEvent[] {
  const json = JSON.stringify(recordedRenderItems(), null, 2);
  const midpoint = Math.floor(json.length / 2);
  return [
    { kind: 'thinking_delta', text: 'The canvas needs something simple to start with — ' },
    { kind: 'thinking_delta', text: 'a Card wrapping a heading and a line of body text.' },
    { kind: 'text_delta', text: 'Here is a simple card to get the canvas going. ' },
    {
      kind: 'text_delta',
      text: 'It replaces the current layout with a Card holding a heading and a short paragraph.\n\n',
    },
    { kind: 'text_delta', text: '```json\n' + json.slice(0, midpoint) },
    { kind: 'text_delta', text: json.slice(midpoint) + '\n```\n' },
    { kind: 'done' },
  ];
}

export class RecordedLlmClient implements LlmClient {
  constructor(private readonly delayMs: number = 15) {}

  async *chatStream(_req: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): AsyncIterable<LlmStreamEvent> {
    for (const event of recordedEvents()) {
      await sleep(this.delayMs);
      yield event;
    }
  }
}
