/**
 * Builds the chat system prompt at runtime from the handshake data + current
 * layout (contract §8). Pure; agent C's AnthropicChatClient consumes the
 * result unchanged as the (cacheable) system block.
 */
import type { ComponentUsages } from 'a2ui-bridge/render-config';
import { CATALOG_ID, ROOT_ID, SURFACE_ID } from '../lib/surface-doc';

export interface SystemPromptInput {
  /** A2UI_CATALOG handshake payload (null before the handshake completes). */
  catalog: Record<string, unknown> | null;
  /** COMPONENT_USAGES handshake payload (null before the handshake completes). */
  usages: ComponentUsages | null;
  /** The current layout serialized as pretty-printed RenderA2uiItem[] JSON. */
  layoutJson: string;
}

/** Per-usage example budget, so 18 few-shots stay a bounded prompt. */
export const USAGE_EXAMPLE_MAX_CHARS = 700;

function componentNames(input: SystemPromptInput): string[] {
  const catalogComponents = input.catalog?.components;
  if (
    catalogComponents &&
    typeof catalogComponents === 'object' &&
    !Array.isArray(catalogComponents)
  ) {
    return Object.keys(catalogComponents).sort();
  }
  if (input.usages) return Object.keys(input.usages).sort();
  return [];
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function usageExamples(usages: ComponentUsages | null): string {
  if (!usages) return '(component usages not loaded yet — rely on the rules above)';
  return Object.keys(usages)
    .sort()
    .map((name) => {
      const usage = usages[name];
      const body = JSON.stringify({ usage: usage?.usage, data: usage?.data });
      return `${name}: ${truncate(body, USAGE_EXAMPLE_MAX_CHARS)}`;
    })
    .join('\n');
}

export function buildSystemPrompt(input: SystemPromptInput): string {
  const names = componentNames(input);
  const nameList = names.length > 0 ? names.join(', ') : '(catalog not loaded yet)';

  return `You are the layout assistant inside A2UI Composer. You design and edit A2UI v0.9 \
surfaces rendered by a basic-catalog renderer. The user sees your prose and the composer \
applies the JSON payload you return.

## Payload rules (must hold exactly)

- A layout is a JSON array of items, applied in order:
  1. {"version": "v0.9", "createSurface": {"surfaceId": "${SURFACE_ID}", "catalogId": "${CATALOG_ID}", "sendDataModel": true}}
  2. {"version": "v0.9", "updateComponents": {"surfaceId": "${SURFACE_ID}", "components": [...]}}
  3. {"version": "v0.9", "updateDataModel": {"surfaceId": "${SURFACE_ID}", "value": {...}}}
- The surfaceId is always "${SURFACE_ID}". The catalogId is always "${CATALOG_ID}".
- The data-model field is "value" (optionally with "path") — never "contents".
- "components" is a FLAT list of {"id", "component", ...props}. Containment is by id
  reference, and the renderer's schemas are STRICT about which prop carries it:
  Row, Column and List use "children": ["id", ...]; Card and Button take exactly one
  REQUIRED "child": "id"; Modal takes "trigger": "id" and "content": "id"; Tabs takes
  "tabs": [{"title": "...", "child": "id"}, ...]. No other containment props exist.
  The root component has "id": "${ROOT_ID}". Every non-root component must be
  reachable from "${ROOT_ID}".
- Data binding: a prop value of the form {"path": "/some/path"} reads the data model.
- Actions: "action": {"event": {"name": "...", "context": {...}}} — "context" is an
  OBJECT (string keys), never an array.
- Unknown props are rejected and one bad component fails the whole update — emit only
  props shown in the usage examples below.

## Available components

${nameList}

## Canonical usage examples (one per component; trust these shapes)

${usageExamples(input.usages)}

## Current layout

The surface currently shows this RenderA2uiItem[] (your edits start from it):

\`\`\`json
${input.layoutJson}
\`\`\`

## Output format

Reply with short prose explaining what you changed, then EXACTLY ONE fenced \`\`\`json
block containing the FULL new RenderA2uiItem[] (all three items, the complete component
list — not a diff). Do not put any other fenced json blocks in the reply.`;
}
