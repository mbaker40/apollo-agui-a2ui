# Custom A2UI Composer — build contract

This is the **shared source of truth** for the custom composer initiative:
a greenfield React composer shell (`apps/composer`) driving a custom-styled
React basic catalog (`apps/catalog`) in a sandboxed iframe, speaking the
official A2UI Preview Bridge protocol. Everything cross-cutting (message
shapes, ports, ids, storage keys, deploy layout) is pinned here; if code and
this document disagree, fix one of them in the same change.

Upstream reference: the official composer repo is cloned read-only at
`/home/user/a2ui-project/composer` (commit `40463c8`, Apache-2.0). The
renderer-side bridge is vendored at `packages/a2ui-bridge` (see its README
for provenance and the one local patch).

## 1. Topology and ownership

| Workspace              | What it is                                                                                                                                                      | Dev port |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- |
| `apps/composer`        | Host shell: glossary, iframe canvas + drop overlay, JSON/data/event drawer, Anthropic chat                                                                      | **7464** |
| `apps/catalog`         | Renderer: `useA2uiSandbox([basicCatalog])` + brand reskin + DnD hit-test sidecar                                                                                | **7465** |
| `packages/a2ui-bridge` | Vendored renderer-side bridge (catalog imports `a2ui-bridge/react`; composer ONLY `…/messages` and `…/render-config` — the root export has window side effects) | —        |

The composer must also work against the **official** react-basic-catalog
(bridge-standard messages only), and our catalog must work inside the
**official hosted composer** (it is a standard bridge renderer; the sidecar
is additive). Neither side may require the other's extensions.

The MWE stack (`services/*`, `apps/web`, mobile) is untouched by this
initiative except: root README link, `Makefile`, and the Pages workflow.

## 2. Bridge protocol (authoritative summary)

Envelope: plain `postMessage` of `{type: PreviewBridgeMessageType, payload?}`.
Types/payload interfaces: import from `a2ui-bridge/messages`.

**Iframe URL contract**: the composer loads the catalog as
`<rendererUrl>?origin=<encodeURIComponent(composer window.location.origin)>&theme=<light|dark>`.
The `?origin=` param is REQUIRED whenever composer and catalog are on
different origins (they always are in dev: 7464 vs 7465): the renderer sends
its messages to that origin and accepts host messages only from its own
origin or that param (`domain-origin-verification.ts`).

**Host-side origin rule** (composer): accept a message only if
`event.source === iframe.contentWindow` AND
`event.origin === new URL(rendererUrl, location.href).origin`; post outgoing
messages with that exact `targetOrigin` (never `*`).

**Handshake sequence** (composer side):

1. Mount iframe → wait for `RENDERER_READY` (no payload). Buffer any
   outbound messages until then (the official shell does; so do we).
2. On ready: send `SET_THEME {theme}`, then `GET_CATALOG`, then
   `GET_COMPONENT_USAGES`.
3. Renderer replies `A2UI_CATALOG {payload: catalogJson | {error:{message}}}`
   and `COMPONENT_USAGES {payload: ComponentUsages}`.
4. Send the current surface via `RENDER_A2UI` (and again on every doc
   change). Note the renderer defers remounts containing `createSurface` by
   one macrotask (two-step dispatch) — never assume synchronous DOM.

**Renderer → host messages the composer must handle**: `RENDERER_READY`,
`A2UI_CATALOG`, `COMPONENT_USAGES`, `DATA_MODEL_CHANGE`
(`{updateDataModel: {surfaceId, value}}` — full model snapshot),
`SEND_TO_SERVER` (`{version:'v0.9', action}` — user interactions; show in
event log), `SURFACE_RESIZE` (`{height, width?}` — resize the iframe to
content height), `CONSOLE_LOG` (`{level, message, stack?}` — event log),
`FORCE_UNBLOCK`. Unknown types: log to the event log, don't crash.

**Host → renderer**: `RENDER_A2UI` (payload = `RenderA2uiItem[]`),
`DATA_MODEL_CHANGE`, `SET_THEME {theme:'light'|'dark'}`,
`GET_CATALOG`, `GET_COMPONENT_USAGES`, `SET_BLOCKING_STATE` (unused for now).

**`GET_CATALOG` server contract** (catalog app): the bridge fetches relative
`catalog` (falling back to `catalog.json`); the catalog app serves the basic
catalog definition from `public/catalog` exactly like the official sample
(18 components, catalogId URN below).

## 3. RENDER_A2UI payload shapes (v0.9)

Canonical apply sequence, exactly like the official shell's gallery:

```jsonc
[
  {
    "version": "v0.9",
    "createSurface": {
      "surfaceId": "composer-canvas",
      "catalogId": "https://a2ui.org/specification/v0_9/basic_catalog.json",
      "sendDataModel": true,
    },
  },
  {
    "version": "v0.9",
    "updateComponents": { "surfaceId": "composer-canvas", "components": [/* flat list */] },
  },
  {
    "version": "v0.9",
    "updateDataModel": { "surfaceId": "composer-canvas", "value": {/* object */} },
  },
]
```

- The data-model field is **`value`** (optionally with `path`), not `contents`.
- Components are a **flat id-referenced list**: `{id, component, ...props}`
  with containment via `children: [ids]` (Row/Column/List/Card/Tabs/Modal)
  or `child: id` (Button). The root component has `id: "root"`.
- Data binding: prop values of the form `{"path": "/some/path"}`.
- Actions: `"action": {"event": {"name": "...", "context": [...]}}`.
- Constants: surfaceId **`composer-canvas`**; catalogId
  **`https://a2ui.org/specification/v0_9/basic_catalog.json`**.
- The 18 basic-catalog components: Text, Image, Icon, Video, AudioPlayer,
  Row, Column, List, Card, Tabs, Modal, Divider, Button, TextField,
  CheckBox, ChoicePicker, Slider, DateTimeInput.

`ComponentUsages` (from `a2ui-bridge/render-config`) =
`Record<componentName, {usage: Record<string,unknown>[]; data?: Record<string,unknown>}>`
— per-component canonical example trees. **This is the glossary's data
source** (keys → glossary entries; `usage` → the snippet inserted on drop;
`data` → data-model seed). Reference content:
`/home/user/a2ui-project/composer/samples/react-basic-catalog/src/usages.ts`.

## 4. COMPOSERX drag-and-drop sidecar (our extension)

Rides the same postMessage channel, same envelope, `COMPOSERX_`-prefixed
types (the vendored bridge ignores them; app-level listeners handle them).
Same origin rules as §2. All coordinates are **CSS pixels in the catalog
iframe's viewport** (the composer overlay converts pointer coords by
subtracting the iframe's bounding rect).

Catalog → composer, once after `RENDERER_READY`:

```ts
{ type: 'COMPOSERX_SIDECAR_READY',
  payload: { features: ['dnd-hittest'], version: 1 } }
```

Composer → catalog during a drag (throttle to animation frames):

```ts
{ type: 'COMPOSERX_DND_HOVER', payload: { x: number, y: number } }
{ type: 'COMPOSERX_DND_END' }            // drag finished or left the canvas
```

Catalog → composer in reply to each hover (and after END, clear highlight):

```ts
{ type: 'COMPOSERX_DND_TARGET', payload: {
    targetId: string | null,      // component id under the pointer (null = empty canvas / no hit)
    containerId: string | null,   // the container whose children list an insert would splice into
    index: number | null,         // insertion index within containerId's children
    slot: 'before' | 'after' | 'into' | null,
    rect: { x, y, width, height } | null,  // rect of the drop indicator, iframe CSS px
} }
```

Semantics: hovering a **container** (Row/Column/List/Card/Tabs/Modal) in its
interior → `slot:'into'`, `containerId` = that component, `index` = end (or
between-children position if determinable). Hovering a **leaf** → resolve to
its parent container, `slot:'before'|'after'` by pointer position along the
parent's main axis, `index` accordingly. The **catalog side owns hit-testing
and geometry** (it can see the DOM); it also renders the live drop-indicator
highlight itself using `rect`. The composer decides what to insert and
performs the splice in its document, then re-sends `RENDER_A2UI`.

If the sidecar never announces (official sample as renderer), the composer
falls back to **structural drop**: drop anywhere on the canvas inserts at
the end of a target container chosen in the layout tree view (default:
root). The composer must keep working with zero sidecar messages.

Hit-testing implementation (catalog): maintain a map of rendered component
ids → DOM nodes. First choice: whatever id/attribute `@a2ui/react` already
stamps into the DOM (inspect `node_modules/@a2ui/react` — if it renders
`id` or a data attribute per component, use it). Otherwise wrap/extend the
catalog components so each instance renders `data-a2ui-id="<component id>"`
on its outermost element, then hit-test via `document.elementFromPoint` +
`closest('[data-a2ui-id]')`. The sidecar also listens to `RENDER_A2UI`
messages (read-only) to know the current component tree (children arrays)
for computing `containerId`/`index`.

## 5. Composer surface document + editing ops

Composer state (single source of truth) is a `SurfaceDoc`:

```ts
{ surfaceId: 'composer-canvas', catalogId: <URN>,
  components: A2uiComponentInstance[],  // flat list, root id 'root'
  dataModel: Record<string, unknown> }
```

- Serialization: `toRenderMessages(doc): RenderA2uiItem[]` (the §3 sequence).
  The JSON drawer edits **that array as text** (so official example payloads
  paste straight in); parsing back accepts any array of items, taking the
  last `createSurface`/`updateComponents`/`updateDataModel` of the target
  surface (unknown fields preserved on components).
- Empty canvas: components = `[{id:'root', component:'Column', children:[]}]`.
- **Insert op** (glossary drop): take the dropped component's
  `ComponentUsage.usage`, remap every id in the snippet by suffixing
  `-g<n>` (`n` = monotonically increasing per doc; remap `id`, `children`,
  `child`, and any string prop that exactly matches a snippet id), append
  the remapped components to `doc.components`, splice the remapped snippet
  root id (`root` before remapping) into the target container's `children`
  at the target index (or set as Button-style `child` only never — targets
  are containers). Merge `ComponentUsage.data` into `doc.dataModel`
  (shallow, existing keys win). No orphan components: every non-root
  component is reachable from `root`.
- Undo/redo: bounded snapshot stack of serialized docs (50 entries) —
  every applied insert/JSON-apply/chat-apply pushes one.
- All ops are pure functions in `src/lib/surface-doc.ts` with unit tests
  (id remap, splice positions, orphan invariant, round-trip
  parse(serialize(doc)) === doc).

## 6. Styling contract (catalog reskin)

How `@a2ui/react@0.10.2` styling actually works (verified against the
installed package + the official sample):

- Component styles are **JS-injected** (`@a2ui/react/styles` exports
  `structuralStyles`/`removeStyles`); there is no importable stock CSS file.
- Components consume **`--a2ui-color-*` CSS custom properties**: `surface`,
  `on-surface`, `background`, `on-background`, `input`, `on-input`,
  `border` (see the official sample's `index.html`, which defines them for
  light and `.dark-theme`/`[data-theme='dark']`). Defining these IS the
  supported restyling channel — our `brand.css` sets them to brand values.
- Some components also render stable classes (`a2ui-card`,
  `a2ui-date-time-input`, `a2ui-modal-*`, `a2ui-icon`, ...) — override
  these for radius/shadow/typography/accent details the tokens don't reach.
  Because component styles are injected at runtime (later in document
  order), overrides must win by **specificity** (e.g. prefix `html body`)
  or `!important` where unavoidable — verify visually, don't assume.
  `basicCatalog.themeSchema` exists and may offer a richer hook; explore
  it, use it if it's straightforward, but tokens+CSS is the required
  baseline. Icons use the `material-symbols-outlined` class; the sample
  loads no icon font — add the Google Fonts `<link>` for Material Symbols
  in `index.html` with a graceful text fallback (it may be blocked in some
  environments, including this session's egress proxy).
- Theme plumbing: the bridge sets `data-theme="light|dark"` + `.dark-theme`
  class + `color-scheme` on `<html>`/`<body>` (from `SET_THEME` or the
  `?theme=` URL param). `brand.css` must key off those hooks and render
  both themes correctly.
- Brand (distinct from the stock neutral look): accent `#6d28d9`
  (violet-700) / dark-theme `#a78bfa`; radius 10px; font stack
  `'Avenir Next', 'Segoe UI', system-ui, sans-serif`; warm off-white light
  background `#faf9f7` / dark `#17131f`. Map these onto the
  `--a2ui-color-*` tokens plus our own `--brand-*` tokens for rules the
  a2ui tokens don't cover. Restyle at minimum: Button (filled accent,
  radius, hover/active), Card (border + soft shadow + radius), TextField /
  CheckBox / Slider / ChoicePicker (accent focus/checked states), Text
  headings, Tabs (accent active indicator), Divider, Modal. The composer
  shell reuses the same palette for a coherent look.

## 7. Composer shell UX (what "done" looks like)

Three-pane layout: **glossary** (left, collapsible), **canvas** (center:
iframe + transparent drop overlay + toolbar: undo/redo, clear, theme
toggle, renderer URL indicator), **chat** (right). Bottom drawer with tabs:
**Layout JSON** (editable textarea + Apply/Format/Reset, error surface on
invalid JSON), **Data model** (read-only pretty JSON, live via
DATA_MODEL_CHANGE), **Events** (SEND_TO_SERVER / CONSOLE_LOG / bridge
lifecycle, newest first, cap 200). Glossary entries: component name +
one-line description, HTML5 `draggable`, click = insert into selected
container (keyboard/no-sidecar path). Canvas shows a "waiting for renderer"
state until RENDERER_READY and an error state if the iframe never
handshakes (10s timeout with the renderer URL shown).

Settings (gear): renderer URL (default per §9, BYO renderer supported),
Anthropic API key (password field), model picker. Persisted in
localStorage under keys `composerx.rendererUrl`, `composerx.apiKey`,
`composerx.model`, `composerx.theme`.

## 8. LLM chat contract (agent C's milestone; B stubs the seam)

```ts
interface LlmClient {
  chatStream(req: {
    system: string;
    messages: { role: 'user' | 'assistant'; content: string }[];
  }): AsyncIterable<LlmStreamEvent>;
}
type LlmStreamEvent =
  | { kind: 'text_delta'; text: string }
  | { kind: 'thinking_delta'; text: string }
  | { kind: 'done' }
  | { kind: 'error'; message: string };
```

B ships the chat panel UI against this interface with a
`RecordedLlmClient` (deterministic scripted replies for tests/e2e, selected
when `localStorage['composerx.mockLlm'] === '1'` or
`import.meta.env.VITE_MOCK_LLM === '1'`). C adds `AnthropicChatClient`
(`@anthropic-ai/sdk`, `dangerouslyAllowBrowser: true`, streaming, adaptive
thinking with summarized display, default model `claude-opus-5`, prompt
caching on the system block). System prompt is built at runtime from the
A2UI_CATALOG + COMPONENT_USAGES handshake data + current layout JSON.
Assistant replies carry prose plus one fenced ```json block containing a
RenderA2uiItem[]; on stream completion the composer parses the LAST fenced
JSON array, validates it, applies it to the SurfaceDoc (undo-able), and
marks the message "applied" (or shows the parse error inline).

## 9. Renderer URL resolution + deploy layout

Default renderer URL: `localStorage['composerx.rendererUrl']` if set; else
`import.meta.env.VITE_RENDERER_URL` if set; else in dev
(`import.meta.env.DEV`) `http://localhost:7465/`; else (production build)
`new URL('catalog/', document.baseURI).href`.

GitHub Pages deploy (one artifact, project site):

- composer built with `base: '/apollo-agui-a2ui/'` → artifact root
- catalog built with `base: '/apollo-agui-a2ui/catalog/'` → artifact
  `catalog/` subdir (its `public/catalog` file ends up at
  `catalog/catalog`, which is exactly what relative `GET_CATALOG` fetches)
- Vite configs take base from env: `base: process.env.COMPOSER_BASE ?? '/'`
  (workflow sets it; dev stays `/`)

Same-origin in production means `?origin=` matches automatically; localhost
renderer against the deployed HTTPS composer still works (browsers treat
`http://localhost` as a trustworthy origin for mixed-content iframes).

## 10. Verification bar (every wave)

Scoped commands only (never root `pnpm -r` while other agents are mid-work):
`pnpm --filter <pkg> typecheck | test | build`, `pnpm exec eslint <dir>`,
`pnpm exec prettier --check <dir>`. Unit tests: vitest + jsdom (surface-doc
ops, bridge-host reducer with fake postMessage, sidecar hit-test math,
usages sanity: every catalog component has a usage entry whose component
names are all in the catalog). Browser truth (rendered DOM, real
cross-frame postMessage) is exercised in wave-3 Playwright e2e
(`/opt/pw-browsers/chromium`), not by unit tests. Deps are preinstalled —
if something is missing, note it in your report instead of editing
package.json/lockfile.
