# @mwe/composer-catalog

Custom-styled React **basic catalog renderer** for the A2UI composer. Runs in a
sandboxed iframe and speaks the official A2UI Preview Bridge protocol (via the
vendored `packages/a2ui-bridge`), plus the additive `COMPOSERX_*` drag-and-drop
sidecar defined in [`docs/composer/CONTRACT.md`](../../docs/composer/CONTRACT.md)
(section 4). Dev port: **7465**.

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

## COMPOSERX DnD sidecar

Message shapes and semantics: contract section 4. Split into:

- `src/sidecar-math.ts` — pure logic, unit-tested: mirrors the component tree
  from `RENDER_A2UI` traffic (createSurface resets, updateComponents upserts,
  deleteSurface clears) and resolves `{x, y, hitId}` into
  `{targetId, containerId, index, slot, rect}`:
  - container hit (Row/Column/List/Card/Tabs/Modal) → `slot: 'into'`, index
    between children along the container's main axis (Row / horizontal List →
    x, otherwise y), caret rect in the gap (or inset interior rect when the
    container has no children);
  - leaf hit → walk up to the nearest ancestor with a `children` array; the
    path child is the anchor; `before`/`after` by pointer vs anchor midpoint,
    caret rect at the anchor's edge;
  - background / empty canvas → `'into'` the root (`targetId: null`).
- `src/sidecar.ts` — DOM plumbing, started from `main.tsx`: origin-checked
  message listener (`DomainOriginVerificationService`, same rules as the
  bridge), hit-testing, `COMPOSERX_DND_TARGET` replies posted to the same
  target origin the bridge uses (`?origin=` param, else our own origin), and
  the drop indicator itself (a `position: fixed` overlay layer that can never
  feed back into `SURFACE_RESIZE` measurements; cleared on
  `COMPOSERX_DND_END` and on new `RENDER_A2UI`).
- `COMPOSERX_SIDECAR_READY {features: ['dnd-hittest'], version: 1}` is posted
  from an `App` effect that runs directly after `useA2uiSandbox`'s effect, so
  it always follows `RENDERER_READY`. Under React StrictMode (dev) both are
  emitted twice — hosts must tolerate duplicates (the official shell does).

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
untouched (verified in-browser). Hit-testing is
`document.elementFromPoint(x, y).closest('[data-a2ui-id]')`; rects come from
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
