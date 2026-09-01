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

**Chat needs either an Anthropic API key (Settings gear) or the recorded
mock** — see [Chat: the Anthropic client](#chat-the-anthropic-client) below.

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
  Backed by the real Anthropic client below (or the recorded mock).
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

## Chat: the Anthropic client

The chat panel is backed by `AnthropicChatClient`
(`src/chat/anthropic-client.ts`, implementing the `LlmClient` seam of
contract §8) using the official `@anthropic-ai/sdk`.

**Adding a key.** Open Settings (gear icon) and paste an Anthropic API key.
It is stored in `localStorage` under `composerx.apiKey` — browser-only, never
bundled, never sent anywhere except `api.anthropic.com`. Key and model are
re-read from Settings on every send, so changes take effect on the next
message without a reload. Clear the field to remove the key.

**Model picker.** `claude-opus-5` (Opus 5, default), `claude-sonnet-5`
(Sonnet 5), `claude-haiku-4-5-20251001` (Haiku 4.5).

**Direct-from-browser architecture.** There is no proxy server: requests go
straight from your browser to `api.anthropic.com` using the SDK's
`dangerouslyAllowBrowser: true`, which lifts the SDK's browser guard and
sends the `anthropic-dangerous-direct-browser-access` CORS opt-in header.
That flag exists because a key embedded in shipped frontend code would be
public; here it is safe-by-construction: each visitor supplies their own key
at runtime, and no key ever ships in the bundle. Treat the key like a
password on shared machines — anyone with access to the browser profile can
read `localStorage`.

**Prompt caching.** The system prompt (payload rules + catalog + usage
examples + current layout, built by `src/chat/system-prompt.ts` from the live
handshake) is sent as a single system block with
`cache_control: {type: 'ephemeral'}`, so that large, stable prefix is cached
across turns and follow-up messages only pay for the delta.

**Thinking display.** Extended thinking is enabled — adaptive with
summarized display (`thinking: {type: 'adaptive', display: 'summarized'}`)
on Opus/Sonnet; the dated Haiku 4.5 model predates adaptive thinking and
uses the enabled form with a 4096-token budget. Thinking deltas stream into
the collapsible "Thinking" disclosure above each assistant reply.

**Keyless demo (recorded mock).** Tick "Use the recorded mock LLM" in
Settings, or set `localStorage['composerx.mockLlm'] = '1'`, or run with
`VITE_MOCK_LLM=1`. The chat then streams a deterministic recorded reply
(thinking + prose + a JSON payload that always validates and applies) — ideal
for demos and e2e. The mock takes precedence over a configured key; with
neither, the chat explains how to configure one of them.

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

- **Deploy** — GitHub Pages workflow builds composer at the artifact root
  (`COMPOSER_BASE=/apollo-agui-a2ui/`) with the catalog under `catalog/`
  (contract §9); wave-3 Playwright e2e covers real cross-frame messaging.
