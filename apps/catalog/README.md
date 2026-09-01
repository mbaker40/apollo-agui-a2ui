# @mwe/composer-catalog

Custom-styled React **basic catalog renderer** for the A2UI composer. Runs in a
sandboxed iframe and speaks the official A2UI Preview Bridge protocol (via the
vendored `packages/a2ui-bridge`), plus the additive `COMPOSERX_*` **sidecar v2**
defined in [`docs/composer/CONTRACT.md`](../../docs/composer/CONTRACT.md)
(sections 4, 4b, 4c, 4d): drag-and-drop hit-testing with Figma-like dashed drop
indicators, edit/preview modes with click-to-select and selection outlines, and
schema-derived prop specs. Dev port: **7465**.

## Quickstart

```sh
pnpm --filter @mwe/composer-catalog dev        # http://localhost:7465/
pnpm --filter @mwe/composer-catalog test       # vitest (jsdom)
pnpm --filter @mwe/composer-catalog typecheck
pnpm --filter @mwe/composer-catalog build      # COMPOSER_BASE=/apollo-agui-a2ui/catalog/ for Pages
```

## Using it from a composer

- **Our composer (`apps/composer`)**: automatic — its default renderer URL is
  `http://localhost:7465/` in dev and `catalog/` relative to the deployed site
  in production (contract section 9). No configuration needed.
- **The official hosted composer**: run the dev server, then paste
  `http://localhost:7465/` as the renderer URL. This works from an HTTPS host
  because browsers treat `http://localhost` as a trustworthy origin. The
  composer appends `?origin=<its origin>&theme=<light|dark>`; the bridge only
  accepts host messages from that origin (or our own) and posts replies to it.
  Everything `COMPOSERX_*` is additive — a host that ignores it sees a fully
  standard bridge renderer (`RENDERER_READY`, `A2UI_CATALOG` served from
  `public/catalog`, `COMPONENT_USAGES` from `src/usages.ts`, `RENDER_A2UI`,
  `DATA_MODEL_CHANGE`, `SEND_TO_SERVER`, `SURFACE_RESIZE`, ...).

## Reskin architecture (what actually styles `@a2ui/react@0.10.2`)

Verified against the installed package:

- The package injects **only zero-specificity token defaults**
  (`:where(:root) { --a2ui-*: ... }` through `document.adoptedStyleSheets`);
  component visuals are mostly **inline styles that read `--a2ui-*` custom
  properties with fallbacks** (e.g. Card: `border: var(--a2ui-card-border,
var(--a2ui-border))`). `basicCatalog.themeSchema` is **undefined** in 0.10.2,
  so there is no theme-object API — tokens + CSS is the mechanism.
- Therefore the reskin is **token-first**:
  - `index.html` defines the seven documented `--a2ui-color-*` tokens for
    light and dark (keyed off the `.dark-theme` class / `data-theme`
    attribute the bridge sets, plus a `prefers-color-scheme` fallback when no
    explicit theme was requested).
  - `src/brand.css` redefines the extended `--a2ui-*` tokens (primary,
    radius, card border/shadow, tabs, slider, modal, datetimeinput, ...) to
    the violet brand (`#6d28d9` light / `#a78bfa` dark, 10px radius,
    `'Avenir Next'` stack, warm off-white `#faf9f7` / deep `#17131f`).
  - CSS rules cover what tokens cannot reach: Button, TextField internals and
    ChoicePicker rows carry **no usable classes upstream** (the CSS-module
    class objects compile to `{}`, so buttons literally render
    `class="undefined"`), so those are targeted through our
    `[data-a2ui-component='X']` wrapper attribute (see below) and the stable
    classes that do exist (`a2ui-card`, `a2ui-tab-button`, `a2ui-modal-*`,
    `a2ui-date-time-input`, `.chip`, `material-symbols-outlined`).
    `!important` is used exactly once (modal close-button hover, which must
    beat an inline `background: none`).
- Icons: `index.html` loads Material Symbols from Google Fonts; when the font
  is unavailable (e.g. blocked egress) the icon degrades to its ligature name
  as text.
- Plain body text goes through the markdown pipeline; like the official
  sample we configure no markdown renderer, so it renders as plain text (the
  package logs a one-time console warning).

## COMPOSERX sidecar v2

Message shapes and semantics: contract sections 4/4b/4c/4d. Features
announced right after the bridge handshake:

```ts
{ type: 'COMPOSERX_SIDECAR_READY',
  payload: { features: ['dnd-hittest', 'select', 'prop-specs'], version: 2 } }
```

immediately followed by `COMPOSERX_PROP_SPECS` (section 4d, below). Both are
posted from an `App` effect that runs directly after `useA2uiSandbox`'s
effect, so they always follow `RENDERER_READY`. Under React StrictMode (dev)
everything is emitted twice — hosts must tolerate duplicates (the official
shell does). Split into:

- `src/sidecar-math.ts` — pure logic, unit-tested: mirrors the component tree
  from `RENDER_A2UI` traffic (createSurface resets, updateComponents upserts,
  deleteSurface clears) and resolves `{x, y, hitId}` into
  `{targetId, containerId, index, slot, rect}`:
  - children-array container hit (Row/Column/List) → `slot: 'into'`, index
    between children along the container's main axis (Row / horizontal List →
    x, otherwise y), caret rect in the gap (or inset interior rect when the
    container has no children);
  - leaf hit (including single-slot Card/Button/Modal/Tabs) → walk up to the
    nearest ancestor with a `children` array; the path child is the anchor;
    `before`/`after` by pointer vs anchor midpoint, caret rect at the
    anchor's edge;
  - background / empty canvas → `'into'` the root (`targetId: null`).
- `src/prop-specs.ts` — pure derivation of per-component `PropSpec[]` from
  the REAL zod schemas (see "Prop specs" below).
- `src/sidecar.ts` — DOM plumbing, started from `main.tsx`: origin-checked
  message listener (`DomainOriginVerificationService`, same rules as the
  bridge), hit-testing, `COMPOSERX_DND_TARGET` replies posted to the same
  target origin the bridge uses (`?origin=` param, else our own origin), the
  edit veil, and the indicator/outline overlay layers (all `position: fixed`
  with `overflow: hidden` and `pointer-events: none`, so they can never feed
  back into `SURFACE_RESIZE` measurements).

### Edit/preview modes + selection (contract 4c)

- `COMPOSERX_SET_MODE {mode: 'edit' | 'preview'}` — **default is `preview`** (a
  COMPOSERX-unaware host like the official hosted composer gets a fully
  interactive standard renderer)
  before any message arrives. Mode switches are idempotent.
- **Edit mode** installs a transparent full-viewport **edit veil**
  (`pointer-events: auto`, stacked above the surface and below the indicator
  layers) that swallows every pointer interaction: Buttons cannot fire their
  actions, TextFields cannot be focused or typed into (a capture-phase
  `focusin` guard also blurs anything that acquires focus by keyboard).
  Clicks hit-test through the veil with `document.elementsFromPoint`,
  skipping the sidecar's own layers, and post
  `COMPOSERX_SELECT {id: <deepest data-a2ui-id> | null}` (null = background
  click). Moving the pointer draws a local, rAF-throttled 1px accent hover
  outline (no messages).
- `COMPOSERX_SET_SELECTION {id | null}` (the composer is the source of
  truth) renders a **solid 2px accent outline, offset 1px** around the
  component's rect. It re-anchors after every `RENDER_A2UI` (re-measured on
  chained timeouts + animation frames, because the bridge defers
  `createSurface` remounts by a macrotask), on window resize/scroll, and via
  a `ResizeObserver` on the selected component's first box. If the id no
  longer renders, the outline is removed.
- **Preview mode** removes the veil and all hover/selection outlines;
  components behave fully live (actions → `SEND_TO_SERVER`). The selection
  id is retained sidecar-side and redrawn on the next switch to edit.
- Note: the mode default means a host that never speaks COMPOSERX (e.g. the
  official hosted composer) gets an inert canvas — that is the contract's
  deliberate default; our composer re-sends the mode on every handshake.

### Dashed drop indicators (contract 4b)

Drawn by the catalog during a drag, all in brand-accent tokens (theme-aware
in light and dark), cleared on `COMPOSERX_DND_END`:

- `'before'`/`'after'` → a **2px dashed accent insertion line** with small
  dot end-caps at the caret rect, plus a **faint 1px dashed outline** around
  the container being spliced into;
- `'into'` → a **2px dashed accent outline (6px radius)** around the
  container rect with a very light accent wash inside;
- no target → nothing.

### Prop specs (contract 4d)

`src/prop-specs.ts` walks each catalog component's zod schema (the branded
wrapper preserves `name`+`schema` from `@a2ui/web_core`'s ComponentApi
objects) and posts, once after `SIDECAR_READY`:

```ts
{ type: 'COMPOSERX_PROP_SPECS', payload: { components: { [name]: { props: PropSpec[] } } } }
```

Derivation (verified against the actually-installed zod@3.25.76 classic v3
API — `_def.typeName` internals — with a best-effort zod-v4 fallback):
unwrap Optional/Default/Nullable (`required` = never optional/defaulted);
ZodString/Number/Boolean → that kind; ZodEnum → `'enum'` + options; a union
of one scalar kind with a `{path}` object (DynamicString/Number/Boolean,
nested unions flattened) → the scalar kind + `bindable: true`; everything
else (records, `action` unions, arrays like `checks`/`options`/`tabs`,
accessibility objects, DynamicStringList) → `'json'` (still `bindable` when
a `{path}` member exists). `children`/`child`/`trigger`/`content`/`tabs`
are marked `containment: true`. The derivation never throws: weird props
fall back to `'json'`, components without a usable object schema are
skipped. Fun fact: Icon's `name` derives as a 59-option enum that is also
`bindable`, because its schema unions the icon-name enum with `{path}`.

### DOM → component-id mapping (the investigated part)

`@a2ui/react@0.10.2` stamps **no id or data attribute** into the DOM. But
every catalog implementation's `render` receives its `ComponentContext`
(`context.componentModel.id` / `.type`), and `basicCatalog` is a plain
`Catalog` instance whose components can be re-wrapped. `src/branded-catalog.tsx`
builds `brandedBasicCatalog`: every component render is wrapped in

```html
<span style="display: contents" data-a2ui-id="<id>" data-a2ui-component="<type>"></span>
```

`display: contents` generates no box, so Row/Column/List flex layout is
untouched (verified in-browser). Hit-testing walks
`document.elementsFromPoint(x, y)` (topmost first), skips the sidecar's own
veil/overlay layers, and takes the first element's
`closest('[data-a2ui-id]')` — i.e. the deepest component; rects come from
the union of the wrapper's descendant boxes (the wrapper itself has none).
The wrapped catalog is protocol-identical to the stock one: the message
processor looks catalogs up by `id`, which the bridge re-stamps from
`createSurface.catalogId` before processing. If this app ever runs without
the wrapper (e.g. someone swaps in the stock `basicCatalog`), hover
resolution degrades to the empty-canvas → root path and the composer's
structural-drop fallback still works.

## Upstream drift fixed in `src/usages.ts`

The sample's snippets predate the strict zod schemas in
`@a2ui/web_core@0.10.6`; shipped verbatim they would fail validation inside
the renderer the moment the composer inserts them. Local fixes (each guarded
by `test/usages.test.ts`, which parses every snippet against the real
schemas): Button `context` record form + `variant: 'primary'`;
`usageHint` → `variant`; ChoicePicker `value` list; Icon `check`; Slider
`min`/`max`; TextField `variant`; plus an added Tabs entry (upstream ships
none; the contract requires one per catalog component). **Note for the
composer/chat side:** contract section 3 still shows the
`context: [...]` array form — the installed schema requires the record form.

## Provenance

Portions of this app are replicated or adapted from the Apache-2.0 licensed
official composer repository (`github.com/a2ui-project/composer`, commit
`40463c8`), sample `samples/react-basic-catalog`: `index.html`,
`src/main.tsx`, `src/App.tsx`, `src/usages.ts`, `test/test-setup.ts`,
`test/app.test.tsx` (from `src/main.spec.tsx`), and `public/catalog`
(verbatim). Those files keep their upstream copyright headers plus a
provenance note describing local changes. The bridge itself is vendored at
`packages/a2ui-bridge` (see its README and NOTICE).
