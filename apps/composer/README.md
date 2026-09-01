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

- **Glossary** (left, collapsible) — one **visual tile** per component from
  the renderer's `COMPONENT_USAGES` handshake: a hand-built, theme-aware
  mini-preview glyph (violet pill for Button, framed card for Card, track +
  thumb for Slider, …) above the name, with the long description in the
  tile's tooltip. Unknown component names from BYO catalogs get a generic
  glyph. Drag a tile onto the canvas — the preview glyph itself is the drag
  ghost (`setDragImage`) — to insert the component's canonical usage snippet
  at the drop position (when the catalog's DnD sidecar is present) or into
  the derived insert target (fallback). Clicking a tile inserts into the
  derived insert target too (see selection below).
- **Canvas** (center) — toolbar (undo / redo / clear / theme toggle /
  **Edit | Preview mode toggle** / renderer URL indicator / settings), a slim
  **layout tree** strip, and the renderer iframe. Every tree node is
  clickable and shares the unified selection (containers stay visually
  distinguished — inserts land in them), and every non-root node can be
  dragged to rearrange the layout (see "Moving placed components" below);
  tree rows also take glossary-tile drops as positioned inserts. The iframe
  height follows
  `SURFACE_RESIZE` (min 320px). A transparent drop overlay sits over the
  iframe only while a glossary drag is in flight; it streams
  `COMPOSERX_DND_HOVER` coordinates (rAF-throttled) and reads
  `COMPOSERX_DND_TARGET` replies for precision drops.
- **Right sidebar** — two tabs, Figma-style:
  - **Design**: the inspector for the selected component (see below).
  - **Chat**: user/assistant bubbles, a collapsed "Thinking" disclosure per
    assistant message, stop button. When a reply finishes, the LAST fenced
    ```json block is parsed as a full `RenderA2uiItem[]` and applied
    (undo-able); the message gets an "applied" chip, or an inline error chip.
    Backed by the real Anthropic client below (or the recorded mock). The
    chat stays mounted while you're on Design, so the transcript survives
    tab switches.
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

## Figma-style editing

**Selection.** One selection is shared by canvas clicks, layout-tree clicks,
and the inspector — and it is a **list** (`selectedComponentIds`, ordered and
deduped; the **primary** is the first id, mirrored as `selectedComponentId`
for every single-selection surface). In **edit mode** the catalog's sidecar
intercepts pointer events on the rendered surface and posts
`COMPOSERX_SELECT` with the deepest hit id; the composer validates it,
updates its state, and answers with `COMPOSERX_SET_SELECTION`
`{id: primary, ids: full list}` — a v4 catalog outlines every id (primary
emphasized), a v3 catalog just reads `id`. Clicking the canvas background
(or pressing **Escape**) clears the whole list. Selecting a component
auto-switches the right sidebar to **Design**; manual tab clicks stick until
the next selection. Whenever a doc change (undo/redo, JSON apply, chat
apply, clear, delete) removes selected ids, the list is filtered (the first
survivor becomes the primary) and the catalog is told.

**Multi-select** (contract §4f). Three ways to build a multi-selection:

- **Marquee**: in edit mode, press-drag on empty canvas background rubber
  bands (drawn by the catalog); on release the catalog posts
  `COMPOSERX_MARQUEE {ids}` with the topmost-intersecting candidates and the
  composer **replaces** the selection with them (an empty sweep clears).
- **Shift-click on the canvas** (or a **~350ms touch long-press** — the
  catalog sets `additive: true` on the SELECT) **toggles** the component in
  or out of the list. Removing the primary promotes the next id; removing
  the last id clears. An additive tap never triggers ancestor cycling, and
  it resets the repeat-tap seed — the next plain tap is a fresh select.
- **Shift-click in the layout tree** toggles the row the same way (works
  with ANY renderer — no sidecar involved). Plain clicks stay
  replace-selects everywhere, and a plain select collapses any
  multi-selection to just the clicked id. Repeat-tap **ancestor cycling
  applies only to plain single selects**: while more than one component is
  selected, the next plain tap is always a fresh select.

With 2+ components selected the Design tab shows a **multi-state**
(`inspector-multi`): "N selected", one clickable `type #id` row per selected
component (clicking a row collapses the selection to it — quick honing), a
**Clear** button, and a group **Delete** (`inspector-multi-delete`):

- ids whose **ancestor is also selected are subsumed** — deleting the
  ancestor takes them, so a parent+child selection deletes the parent once;
- **root and single-slot occupants are skipped** (same §5 rules as the
  single delete) and reported via a toast ("2 skipped — single-slot
  occupants (…)"); skipped ids stay selected after the delete;
- everything else is removed in **ONE undo snapshot** (one re-render) — a
  single undo restores the whole group; if nothing in the selection is
  deletable, the delete is refused and the doc is untouched.

**What stays single-selection** in this wave: prop editing, the breadcrumb,
canvas move, and tree reordering. Starting a §4e canvas lift or a tree row
drag with a multi-selection first **collapses** it to the pressed/dragged
component, and glossary insert targets derive from the **primary**.

**Insert target.** Glossary clicks and structural (no-sidecar) drops insert
into the container derived from the selection: the selected component itself
if it's a children-array container (Row/Column/List), else its nearest
container ancestor (walking up through Card/Button/Modal/Tabs slots), else
root. The glossary tooltips and the drop-overlay hint show the derived
target.

**Inspector (Design tab).** With nothing selected it shows a hint. With a
selection it shows the component type + id, a **Delete** button, and a
widget-per-prop form driven by the catalog's `COMPOSERX_PROP_SPECS`
(schema-derived): text inputs for strings, number inputs, checkboxes,
selects for enums, and a small JSON textarea (validated on commit) for
everything else. `bindable` props have a compact **◈ bind toggle** that
switches the widget to a `{path}` input (initialized from the current value
when it already is a binding). Required props carry a `*` marker and cannot
be removed; optional props present on the instance get a **✕** remove
affordance. Containment props (`children`/`child`/`trigger`/`content`/
`tabs`) render read-only — edit those structurally or via the JSON drawer.
Props on the instance that no spec covers appear in an **Advanced** raw-JSON
section. Commit semantics: text/number/JSON commit on blur (text/number also
on Enter; JSON also on Ctrl/Cmd+Enter), selects and checkboxes commit
immediately — **each commit is exactly one undo step** and re-renders the
canvas.

**Delete rules.** Delete removes the selected component and its whole
subtree, splicing it out of the parent's `children` array. It is disabled
(with a hint) for `root` and for single-slot occupants — a Card/Button
`child`, Modal `trigger`/`content`, or a Tabs pane — because removing those
would leave the parent schema-invalid; delete the parent instead, or edit
via JSON. With a multi-selection the same rules apply per id through the
group delete above (subsume descendants, skip slot occupants, one undo
step).

**Moving placed components.** Two drag surfaces sit over the same pure
`moveComponent` op (contract §5): the moved component travels with its whole
subtree, ids are never remapped, the data model is untouched, and **every
applied move is exactly one undo step**.

- **Canvas move** (edit mode, requires the sidecar's `'move'` feature):
  press-and-drag a rendered component; the catalog lifts it (ghost + dimmed
  origin + dashed drop indicators) and the composer receives
  `COMPOSERX_MOVE_START` (selects the component + logs),
  `COMPOSERX_MOVE_DROP` (validated via `canMoveTo`, then applied — the
  payload's `index` is the position **after** the moved id is removed), or
  `COMPOSERX_MOVE_CANCEL` (log only). The composer stays authoritative: an
  invalid drop logs the refusal reason and changes nothing, and all `MOVE_*`
  messages are ignored outright in preview mode.
- **Layout-tree drag** (works with ANY renderer, sidecar or not): every
  non-root tree row is draggable. Hovering a row resolves by thirds of its
  rect — upper third → before it in its parent, lower third → after, middle
  third → into it (children-array container rows only; leaf middles behave
  as before/after by half). Indicators reuse the dashed language: a dashed
  accent insertion line between rows, a dashed outline on an 'into' row.
  Targets `canMoveTo` rejects render as no-drop (dimmed, not-allowed cursor,
  `dropEffect: 'none'`) and refuse the drop. Tree rows also accept
  **glossary-tile drags** with the same position resolution, inserting the
  usage snippet at that exact spot.

**Validity rules** (shared by both surfaces via `canMoveTo`): the target must
be a children-array container (Row/Column/List — never a Card/Button/Modal/
Tabs slot); `root` cannot be moved; single-slot occupants (a Card/Button
`child`, Modal `trigger`/`content`, Tabs panes) cannot be moved on their own
(move the parent instead); and a component can never be moved into itself or
anywhere inside its own subtree. Same-position drops are no-ops (no undo
snapshot); out-of-range indices clamp.

**Modes.** The toolbar's **Edit | Preview** control switches the canvas
between selecting (components inert — a Button won't fire, a TextField won't
type) and a live preview (actions flow to the event log, no outlines).
Edit is the default; the mode is not persisted; both mode and selection are
re-sent to the renderer after every handshake, so they survive a renderer
reload. In preview the composer also ignores any incoming `COMPOSERX_SELECT`.

**Keyboard shortcuts** (host document, ignored while focus is in an
input/textarea/select and while the settings modal is open):

| Key                    | Action                                                                           |
| ---------------------- | -------------------------------------------------------------------------------- |
| `Escape`               | Clear the selection (the whole multi-selection list)                             |
| `Delete` / `Backspace` | Delete the selection under the §4f group rules (no-op when nothing is deletable) |

## Mobile (≤900px)

Under the 900px breakpoint (`MOBILE_BREAKPOINT_PX` in `src/lib/viewport.ts`,
mirrored by the media query in `styles.css`) the shell becomes a
single-column app driven by a fixed bottom tab bar — **Canvas · Add ·
Design · Chat** (testids `mtab-canvas` … `mtab-chat`). The desktop three-pane
layout is untouched at ≥900px.

- **Views, not remounts.** Canvas keeps the full canvas pane (toolbar, tree,
  iframe, drawer — the drawer starts **closed** on mobile); Add is the
  glossary full-width; Design and Chat are the sidebar tabs as full-screen
  views. Switching views only toggles CSS `visibility` on the always-mounted
  panes, so the renderer iframe is never remounted and the bridge handshake
  never replays. Selecting a component (canvas tap or tree tap)
  auto-switches to the Design view, mirroring the desktop tab auto-switch.
- **Tap to insert.** Tapping a glossary tile inserts into the derived insert
  target (same rule as desktop clicks), auto-switches to the Canvas view,
  and shows a ~2.5s toast (`mtoast`) naming what landed where ("Button →
  #root") — tooltips don't exist on touch, the toast carries the
  confirmation. Tap the toast to dismiss it early.
- **Positional drag via grips.** Each tile shows a drag grip
  (`glossary-grip-<Name>`, ≥44px hit area, `touch-action: none`; the tile
  body keeps `pan-y` so the list still scrolls). Dragging the grip starts
  immediately (no long-press): a tile ghost follows your finger, the app
  switches to the Canvas view, and hovering the canvas drives the exact
  same `COMPOSERX_DND_HOVER`/`DND_TARGET` precision-drop path as desktop
  HTML5 drag — release over the canvas to insert at the highlighted
  position (structural fallback unchanged without the sidecar), release
  anywhere else to cancel. The grip drag also works with a mouse in a
  narrow window; ≥900px the grips hide and HTML5 tile drag remains the
  desktop path.
- **Canvas move works under touch.** The §4e press-and-drag move of placed
  components rides pointer events inside the renderer iframe, so it works
  unchanged on mobile. The **layout-tree rows stay tap-select only** on
  touch — HTML5 row drag remains desktop-only (HTML5 drag events never fire
  from touch).
- **Multi-select works under touch.** A ~350ms **long-press** on a rendered
  component is the catalog's additive toggle (it never lifts), and the
  background marquee drag rubber-bands as on desktop. Additive taps and
  marquees keep the Canvas view visible (only plain selects auto-switch to
  Design); open the Design view to see the "N selected" multi-state with the
  group Delete and Clear buttons.
- **Sizing.** App height uses `100dvh` (with a `100vh` fallback); all
  inputs/selects/textareas are ≥16px on mobile (no iOS zoom-on-focus);
  toolbar/tree/drawer controls get ≥44px hit areas, with the toolbar
  scrolling horizontally within its own strip; the settings modal renders
  full-screen; the tab bar is padded by `env(safe-area-inset-bottom)`
  (enabled by `viewport-fit=cover` in `index.html`); the page itself never
  scrolls horizontally.

## BYO renderer

Any bridge-compatible renderer works: set its URL in Settings (persisted, the
iframe remounts and re-handshakes). The composer loads
`<rendererUrl>?origin=<composer origin>&theme=<light|dark>` in a sandboxed
iframe (`allow-scripts allow-same-origin`) and enforces both origin rules of
contract §2 (event.source must be the iframe, event.origin must match the
renderer URL's origin; outgoing messages always target that origin, never
`*`). If the renderer never sends `RENDERER_READY`, the canvas shows an
error state after 10s with the URL and a retry/settings shortcut.

**No-sidecar degradation.** Renderers without the COMPOSERX sidecar (e.g.
the official react-basic-catalog sample) still work with zero sidecar
messages — every sidecar feature is independently optional (the composer
checks the announced `features` array, not the version):

- no `dnd-hittest` → drops fall back to the insert target derived from the
  selection (shown in the drop hint), instead of pointer-precise placement;
- no `select` → canvas clicks don't select (the canvas stays a live
  preview), but tree clicks, the inspector, Escape/Delete, and the mode
  toggle all keep working — `SET_MODE`/`SET_SELECTION` are still sent and
  simply ignored by a standard renderer;
- no `prop-specs` → the inspector falls back to generic JSON rows per prop
  plus an "add prop" row, so every prop stays editable;
- no `move` → no canvas press-and-drag moves, but drag-to-rearrange in the
  layout tree keeps working (it never needs the sidecar);
- no `multi-select` → no marquee and no canvas shift-click/long-press
  toggling (a v3 catalog never sends `additive` or `COMPOSERX_MARQUEE`),
  but tree shift-click still builds multi-selections and the group delete
  still works — the extra `ids` on `SET_SELECTION` is simply ignored by
  older renderers, which outline the primary only.

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
