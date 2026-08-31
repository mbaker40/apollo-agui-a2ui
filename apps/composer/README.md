# @mwe/composer — A2UI Composer shell

A greenfield React shell that hosts an A2UI renderer in a sandboxed iframe,
drives it over the official Preview Bridge postMessage protocol, and lets you
compose A2UI v0.9 layouts by dragging glossary entries onto the rendered
canvas, editing the layout JSON, or chatting. Contract of record:
[`docs/composer/CONTRACT.md`](../../docs/composer/CONTRACT.md).

## Quickstart

```sh
# terminal 1 — the renderer (catalog app, port 7465)
pnpm --filter @mwe/composer-catalog dev

# terminal 2 — the composer (port 7464)
pnpm --filter @mwe/composer dev
```

Open http://localhost:7464/. The canvas shows "Waiting for renderer…" until
the catalog app answers the handshake, then renders a small welcome layout.

**Keyless demo (mock LLM):** open Settings (gear) and tick "Use the recorded
mock LLM", or set `localStorage['composerx.mockLlm'] = '1'` (or run with
`VITE_MOCK_LLM=1`). The chat then streams a deterministic recorded reply whose
JSON payload always validates and applies. Without the mock, chat reports that
the Anthropic client is not wired yet (next milestone).

```sh
pnpm --filter @mwe/composer test | typecheck | build
```

## Pane tour

- **Glossary** (left, collapsible) — one entry per component from the
  renderer's `COMPONENT_USAGES` handshake. Drag an entry onto the canvas to
  insert its canonical usage snippet at the drop position (when the catalog's
  DnD sidecar is present) or into the selected container (fallback). Clicking
  an entry inserts into the currently selected container.
- **Canvas** (center) — toolbar (undo / redo / clear / theme toggle / renderer
  URL indicator / settings), a slim **layout tree** strip (select any
  container as the insert target; root is selected by default), and the
  renderer iframe. The iframe height follows `SURFACE_RESIZE` (min 320px).
  A transparent drop overlay sits over the iframe only while a glossary drag
  is in flight; it streams `COMPOSERX_DND_HOVER` coordinates (rAF-throttled)
  and reads `COMPOSERX_DND_TARGET` replies for precision drops.
- **Chat** (right) — user/assistant bubbles, a collapsed "Thinking"
  disclosure per assistant message, stop button. When a reply finishes, the
  LAST fenced ```json block is parsed as a full `RenderA2uiItem[]` and applied
  (undo-able); the message gets an "applied" chip, or an inline error chip.
- **Bottom drawer** — tabs:
  - **Layout JSON**: the full `RenderA2uiItem[]` as editable text
    (Apply / Format / Reset, inline parse errors, "modified" badge while your
    edits diverge from the doc). Official example payloads paste straight in.
  - **Data model**: read-only pretty JSON — the doc's own data model until the
    first live `DATA_MODEL_CHANGE` snapshot arrives from the renderer.
  - **Events**: newest-first log (cap 200) of bridge lifecycle,
    `SEND_TO_SERVER` actions, `CONSOLE_LOG` entries, and unknown messages.

Clear-canvas empties the layout to a bare root Column (the welcome layout only
seeds the very first load).

## BYO renderer

Any bridge-compatible renderer works: set its URL in Settings (persisted, the
iframe remounts and re-handshakes). The composer loads
`<rendererUrl>?origin=<composer origin>&theme=<light|dark>` in a sandboxed
iframe (`allow-scripts allow-same-origin`) and enforces both origin rules of
contract §2 (event.source must be the iframe, event.origin must match the
renderer URL's origin; outgoing messages always target that origin, never
`*`). Renderers without the COMPOSERX sidecar (e.g. the official
react-basic-catalog sample) still work — drops fall back to the selected
container, i.e. zero sidecar messages required. If the renderer never sends
`RENDERER_READY`, the canvas shows an error state after 10s with the URL and
a retry/settings shortcut.

## Settings & storage keys

| Key                     | Meaning                                  | Default                                                                                           |
| ----------------------- | ---------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `composerx.rendererUrl` | Renderer (iframe) URL                    | `VITE_RENDERER_URL` → dev `http://localhost:7465/` → prod `new URL('catalog/', document.baseURI)` |
| `composerx.apiKey`      | Anthropic API key (browser-only)         | empty                                                                                             |
| `composerx.model`       | Chat model id                            | `claude-opus-5` (Opus 5; also Sonnet 5, Haiku 4.5)                                                |
| `composerx.theme`       | Shell + renderer theme (`light`/`dark`)  | `light`                                                                                           |
| `composerx.mockLlm`     | `'1'` = use the recorded mock LLM client | unset                                                                                             |

The shell theme is applied to `<html data-theme=…>` by an inline script before
React mounts (no flash); the toggle also sends `SET_THEME` to the renderer.

## Next milestones (not in this app yet)

- **Anthropic client (agent C)** — `AnthropicChatClient` implementing
  `src/chat/llm-client.ts` (`@anthropic-ai/sdk`, streaming, adaptive thinking,
  prompt caching), selected when a key is configured. The system prompt
  builder it needs is already here (`src/chat/system-prompt.ts`), fed from the
  live catalog/usages handshake + current layout.
- **Deploy** — GitHub Pages workflow builds composer at the artifact root
  (`COMPOSER_BASE=/apollo-agui-a2ui/`) with the catalog under `catalog/`
  (contract §9); wave-3 Playwright e2e covers real cross-frame messaging.
