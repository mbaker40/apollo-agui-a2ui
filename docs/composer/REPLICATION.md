# Replicating the A2UI Composer in another React app

A handoff for a fresh Claude session. It tells you what the composer is, which
files in this repository carry the real design, what is coupled to the basic
catalog, and how to rebuild the same tool for a **different React app** that
has its own styled-components theme provider, its own components (some outside
the A2UI basic catalog), its own effects, does **not** use `@a2ui/react`, and
already uses `@ag-ui/client`.

Read this file top to bottom, then the files in section 1 in order. Every path
below is real and relative to the repository root. Do not guess at protocol
details from memory: the contract document and the tests pin them.

---

## 0. What you are replicating (the 30-second model)

Two static web apps and one vendored package, glued by a contract:

```
apps/composer  (port 7464)   ──iframe──▶  apps/catalog  (port 7465)
  React shell: glossary, canvas,           React renderer: the A2UI basic
  layer tree, Design inspector,            catalog with a brand reskin, wrapped
  JSON drawer, Anthropic chat,             so every rendered component carries
  undo/redo, mobile tab layout             data-a2ui-id, plus the COMPOSERX
                                           sidecar (hit-testing, selection,
        ▲ postMessage, both directions     move, marquee, group move)
        │
  packages/a2ui-bridge — the official A2UI Preview Bridge protocol, vendored
  (renderer side + pure message/config modules), Apache-2.0 with provenance
```

- The **composer** owns the document (a flat list of A2UI v0.9 components with
  a root id), all editing operations, undo, selection state, and the chat. It
  never touches the renderer's DOM.
- The **catalog** (renderer) owns rendering, theming, hit-testing, and every
  gesture that happens inside the iframe. It mutates nothing; it reports
  gestures as messages and the composer decides.
- The **contract** (`docs/composer/CONTRACT.md`) is the single source of truth
  for every message shape, ownership rule, and UX behavior. Both apps were
  built against it by separate agents; when code and contract disagree, the
  contract wins and the code gets fixed.

Everything the composer needs from a renderer is small and framework-agnostic
in practice: answer the Preview Bridge handshake, re-render a whole document
on demand, stamp two data attributes on each rendered component, send a prop
spec map, declare containment, and map a theme name. That is why the target
app does not need `@a2ui/react` — it needs a **preview host** page that does
those things over its own components.

---

## 1. Read these first, in this order

1. `docs/composer/CONTRACT.md` — the whole thing. Sections: §1 topology and
   ports, §2 bridge protocol, §3 `RENDER_A2UI` payload shapes and the
   containment truth, §4 the COMPOSERX sidecar (4b indicators, 4c selection and
   edit mode, 4d prop specs, 4e canvas move incl. group move, 4f marquee and
   multi-select), §5 document model and editing ops, §6 styling contract,
   §7 shell UX (7b mobile), §9 renderer URL resolution and deploy layout,
   §10 verification bar.
2. `README.md` — the "A2UI Composer (custom)" section (layout table, deploy).
3. `apps/composer/README.md` — pane tour, Figma-style editing, mobile, BYO
   renderer, the Anthropic client, settings keys.
4. `apps/catalog/README.md` — reskin architecture (what actually styles the
   official React catalog), sidecar v5 message reference, DOM→id mapping.
5. `docs/VERIFICATION.md` — what was proven live per wave and how; the
   addenda list the end-to-end checks each feature had to pass.
6. `packages/a2ui-bridge/README.md` and `NOTICE` — provenance (upstream
   `a2ui-project/composer` commit `40463c8`) and the one local patch.

Then read the source in the order of section 2.

---

## 2. Repository map — every file that matters

### 2a. Composer shell — `apps/composer/` (React 19, Vite, vitest/jsdom)

| Path                                                                                       | Role                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/state/store.ts`                                                                       | The external store: all state (doc, undo stack, selection list, mode, prop specs, handshake status, mobile view, toast, events) and all actions. Bridge messages land here (`bridgeReady`, `bridgeCatalog`, `bridgeUsages`, `bridgeSidecarReady`, `bridgePropSpecs`, `bridgeSelect`, `bridgeMarquee`, `bridgeMoveStart/Drop/Cancel`, `bridgeDataModel`, `bridgeAction`; glossary drops enter via the `attachCanvasDnd` seam), as do UI actions (`insertFromDrag`, `commitProp`, `deleteSelected`, `moveComponentTo`, `moveComponentsTo`, undo/redo). Read this file completely. |
| `src/state/context.tsx`                                                                    | React context + `useSyncExternalStore` hooks over the store.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/lib/surface-doc.ts`                                                                   | Pure document ops, the heart of editing: parse/serialize (`parseRenderMessages`, `toRenderMessages`), `insertUsage` (id remap with `-g<n>` suffix), `setComponentProp`/`removeComponentProp` (guarded keys), `removeComponent`, `moveComponent`/`canMoveTo`, `moveComponents`/`canMoveGroupTo`/`partitionForMove`, `partitionForDelete`, `ancestorChainOf`, `singleSlotParentOf`, `movableUnitOf`, `insertTargetFor`, `componentTree`. Also the two basic-catalog constants `CATALOG_ID` and `CONTAINER_COMPONENTS` (see section 4).                                            |
| `src/lib/bridge-host.ts`                                                                   | Host side of the protocol: origin rules, outbound buffering until `RENDERER_READY`, the handshake sequence, parsing of every inbound message (bridge + sidecar), `sendSetSelection`, `sendSetMode`, `sendRenderA2ui` (two-step dispatch).                                                                                                                                                                                                                                                                                                                                       |
| `src/lib/tree-drop.ts`                                                                     | Layer-tree drag resolution (thirds → before/into/after) and `groupMoveIndexFor`/`moveIndexFor` (pre-removal tree index → after-removal document index).                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/lib/welcome.ts`                                                                       | The seed document shown on load (basic-catalog components).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| `src/lib/descriptions.ts`                                                                  | One-line glossary descriptions keyed by component name (basic catalog).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/lib/settings.ts`                                                                      | localStorage keys (`composerx.*`), renderer URL default chain, `buildIframeSrc` (adds `?origin=` and theme).                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `src/lib/viewport.ts`                                                                      | Mobile breakpoint detection (≤ 900px).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `src/components/CanvasPane.tsx`                                                            | Mounts the renderer iframe, registers it with the bridge host, toolbar (undo/redo/clear/theme/Edit-Preview), status dot. The iframe must stay mounted across mobile views.                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/components/Glossary.tsx` + `glossary-previews.tsx`                                    | Visual component tiles (HTML5 drag on desktop, drag-grip pointer gesture on touch, tap-to-insert). `GLYPHS` is a per-component preview map with a generic fallback.                                                                                                                                                                                                                                                                                                                                                                                                             |
| `src/components/Inspector.tsx`                                                             | Design panel: breadcrumb, parent button, schema-derived prop widgets from `PROP_SPECS`, Delete, and the multi-selection state (N selected, group Delete, Clear).                                                                                                                                                                                                                                                                                                                                                                                                                |
| `src/components/LayoutTree.tsx`                                                            | Layer tree: selection follow, shift-click additive, row drag (single and group), no-drop styling.                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| `src/components/Drawer.tsx`                                                                | Layout JSON editor (official payloads paste straight in), data model view, event log.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/components/RightSidebar.tsx`, `SettingsModal.tsx`, `MobileTabBar.tsx`, `shortcuts.ts` | Sidebar tabs (Design/Chat), settings (renderer URL, API key, model, mock), the ≤900px four-tab bar, keyboard shortcuts.                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `src/chat/llm-client.ts`                                                                   | The LLM seam: one interface, streaming events. Implementations: `anthropic-client.ts` (browser-direct SDK, prompt caching, adaptive thinking, model picker) and `recorded-client.ts` (deterministic mock for keyless demos and e2e); `select-client.ts` chooses per send.                                                                                                                                                                                                                                                                                                       |
| `src/chat/system-prompt.ts`                                                                | Builds the system block from the live catalog (component names) plus hand-written containment rules and the exact message shapes the model must emit.                                                                                                                                                                                                                                                                                                                                                                                                                           |
| `src/chat/extract-json.ts`, `ChatPanel.tsx`                                                | Fenced-JSON extraction with an Apply button; the panel UI.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| `src/styles.css`, `src/App.tsx`, `src/main.tsx`                                            | Layout (desktop three-pane, mobile single-column), app root.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `vite.config.ts`                                                                           | `COMPOSER_BASE` for sub-path deploys, port 7464, jsdom tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |

### 2b. Catalog / renderer — `apps/catalog/` (React 19, `@a2ui/react` 0.10.2, `@a2ui/web_core` 0.10.6, zod)

| Path                          | Role                                                                                                                                                                                                                                                                                                                                                                                         |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/sidecar.ts`              | The whole renderer-side gesture engine (v5): edit veil, hit-testing on `pointermove`, dashed drop indicators, click/shift-click/long-press selection, marquee, press-drag move with ghost + dimmed origins + subtree exclusion, group lift, selection outlines, `SIDECAR_READY` announcement, `SET_MODE`, `SET_SELECTION`, `PROP_SPECS` posting. Only posts when `window.parent !== window`. |
| `src/sidecar-math.ts`         | Pure, fully unit-tested geometry and tree logic: `resolveDropTarget` (with subtree exclusion, single id or list), `resolveLiftAnchor`, `collectSubtreeIds`, `marqueeCandidates`, `buildParentIndex`/`allChildIds`, `rectsIntersect`, and `CONTAINER_COMPONENTS`.                                                                                                                             |
| `src/prop-specs.ts`           | Derives the inspector's prop spec map from each component's zod schema (`derivePropSpecs`), with `CONTAINMENT_PROPS` excluded.                                                                                                                                                                                                                                                               |
| `src/branded-catalog.tsx`     | `withComponentTag`: wraps every component's render in a `display:contents` span carrying `data-a2ui-id` and `data-a2ui-component`. This is the entire DOM→id mechanism.                                                                                                                                                                                                                      |
| `src/brand.css`               | The token-first reskin: `--a2ui-color-*` tokens and stable `a2ui-*` class hooks, light + dark, plus edit-mode-only rules such as the 48px dashed zone for empty containers (`html.composerx-edit`).                                                                                                                                                                                          |
| `src/usages.ts`               | `COMPONENT_USAGES`: per-component insert snippets for the glossary (validated against the real zod schemas by tests).                                                                                                                                                                                                                                                                        |
| `src/App.tsx`, `src/main.tsx` | `useA2uiSandbox([catalog], { getComponentUsages })`, then the sidecar announcement in an effect that runs after the bridge's own; `initComposerxSidecar()` before React mounts.                                                                                                                                                                                                              |
| `public/catalog`              | The catalog descriptor JSON the renderer serves for `GET_CATALOG` (fetched as the relative path `catalog`). Carries `catalogId` and the `components` map.                                                                                                                                                                                                                                    |
| `vite.config.ts`              | Port 7465, `COMPOSER_BASE`, jsdom tests with the `@a2ui/*` packages inlined.                                                                                                                                                                                                                                                                                                                 |

### 2c. Vendored bridge — `packages/a2ui-bridge/`

| Path                                                                                                       | Role                                                                                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/bridge-message.ts`                                                                                    | Message type enum + envelope types (`{type, payload}`). Exported as `a2ui-bridge/messages` (pure).                                                                                                                                                                                               |
| `src/render-config.ts`                                                                                     | `ComponentUsages`, theme, catalog-details types. Exported as `a2ui-bridge/render-config` (pure).                                                                                                                                                                                                 |
| `src/preview-bridge.ts`                                                                                    | The renderer-side `PreviewBridge` class: handshake, `RENDER_A2UI`, `GET_CATALOG`, `GET_COMPONENT_USAGES`, `SET_THEME`, `SURFACE_RESIZE`, `DATA_MODEL_CHANGE`, `SEND_TO_SERVER`. Read the `RendererProcessor` interface near the top: it is the seam a non-`@a2ui/react` renderer must implement. |
| `src/domain-origin-verification.ts`                                                                        | Origin acceptance (own origin or the `?origin=` query param).                                                                                                                                                                                                                                    |
| `src/react/react-bridge.ts`                                                                                | `useA2uiSandbox`: builds a `@a2ui/web_core` `MessageProcessor` and hands it to the bridge. This is the only `@a2ui/react`-coupled file; the target app replaces it.                                                                                                                              |
| `src/surface-resize-observer.ts`, `src/instrumentation-overrides.ts`, `src/index.ts`, `src/react/index.ts` | Resize reporting, console instrumentation, barrels.                                                                                                                                                                                                                                              |
| `NOTICE`, `README.md`                                                                                      | License/provenance and the patch list (COMPOSERX_* message types skip the unknown-type warning).                                                                                                                                                                                                 |

The composer imports **only** `a2ui-bridge/messages` and `a2ui-bridge/render-config`
(pure). The catalog imports the runtime and `a2ui-bridge/react`.

### 2d. Deploy, tooling, docs

| Path                                                            | Role                                                                                                                                                                        |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy/composer.Dockerfile`                                    | Multi-stage: pnpm install (manifest-first for cache), build composer at `/` and catalog at `/catalog/`, guard `test -f /site/catalog/catalog`, serve with Caddy on `$PORT`. |
| `.github/workflows/deploy-composer.yml`                         | Same two builds published as one GitHub Pages site (needs a paid plan on private repos).                                                                                    |
| `scripts/composer-dev.sh`, `Makefile` (`composer-dev`, `check`) | Both dev servers; the repo-wide gate.                                                                                                                                       |
| `pnpm-workspace.yaml`, `package.json`, `tsconfig.base.json`     | Workspace wiring (pnpm 10, Node ≥ 22).                                                                                                                                      |
| `docs/screenshots/composer-*.png`                               | What each feature looks like when it is right.                                                                                                                              |

### 2e. Tests that pin the behavior (port these along with the code)

Composer (`apps/composer/test/`, 363 tests): `surface-doc.test.ts` (every doc
op, containment refusals, id remap, orphan invariant, group move), `store.test.ts`
(selection semantics, cycling, additive, marquee, undo, group delete/move,
prop commit guard), `bridge-host.test.ts` (origin rules, buffering, handshake
order, message parsing), `tree-drop.test.ts`, `inspector.test.tsx`,
`layout-tree.test.tsx`, `glossary.test.tsx`, `glossary-grip.test.tsx`,
`canvas-pane.test.tsx`, `drawer.test.tsx`, `mobile-app.test.tsx`,
`mobile-store.test.ts`, `system-prompt.test.ts`, `anthropic-client.test.ts`,
`select-client.test.ts`, `extract-json.test.ts`, `chat-panel.test.tsx`,
`sidebar.test.tsx`, `viewport.test.ts`.

Catalog (`apps/catalog/test/`, 121 tests): `sidecar-math.test.ts`,
`sidecar-v2.test.ts` (selection, edit mode, indicators), `sidecar-move.test.ts`,
`sidecar-marquee.test.ts`, `sidecar-group-move.test.ts`, `prop-specs.test.ts`,
`usages.test.ts` (snippets validated against the real schemas), `app.test.tsx`
(announcement ordering). The DOM-gesture suites show exactly how to drive the
veil with synthetic pointer events and fake timers.

---

## 3. How the pieces talk (one page; the contract has the rest)

**Handshake** (host → renderer unless noted). The iframe URL is
`<rendererUrl>?origin=<host origin>&theme=<light|dark>`. Both sides verify
origins: the host checks `event.source === iframe.contentWindow` and the
renderer's origin; the renderer accepts its own origin or the `?origin=` value.
The host buffers everything until `RENDERER_READY` (renderer → host), then
sends `SET_THEME` → `GET_CATALOG` → `GET_COMPONENT_USAGES` → `RENDER_A2UI` →
`COMPOSERX_SET_MODE` → `COMPOSERX_SET_SELECTION`. The renderer answers with
`A2UI_CATALOG`, `COMPONENT_USAGES`, `SURFACE_RESIZE`, `DATA_MODEL_CHANGE`,
`COMPOSERX_SIDECAR_READY` and `COMPOSERX_PROP_SPECS`.

**RENDER_A2UI** carries A2UI v0.9 items: `createSurface` (surfaceId
`composer-canvas`, `catalogId`, `sendDataModel: true`), `updateComponents`
(flat component list, root id `root`), `updateDataModel` (`value`, not
`contents`). The renderer remounts on `createSurface`, so the host sends the
`createSurface` item first and the rest one macrotask later.

**Document model** (contract §5): a flat list of `{id, component, ...props}`.
Containment in the basic catalog is strict and schema-enforced: `children: [ids]`
only on `Row`, `Column`, `List`; `Card` and `Button` take one required `child`;
`Modal` takes `trigger` + `content`; `Tabs` takes `tabs: [{title, child}]`.
Bindings are `{path: '/x'}`; actions are `{action: {event: {name, context: {...}}}}`
with `context` a record, never an array. One invalid component fails the whole
batch in the renderer.

**Sidecar messages** (v5 announcement: `features: ['dnd-hittest', 'select',
'prop-specs', 'move', 'multi-select', 'group-move'], version: 5`):

| Direction       | Message                                                                                                   | Meaning                                                                                                       |
| --------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| host → renderer | `COMPOSERX_DND_HOVER` / `DND_END`                                                                         | Glossary drag position; renderer draws indicators.                                                            |
| renderer → host | `COMPOSERX_DND_TARGET {containerId, index, slot}`                                                         | Resolved drop target (index after removal).                                                                   |
| host → renderer | `COMPOSERX_SET_MODE {mode: 'edit' \| 'preview'}`                                                          | Edit mounts the interaction veil; renderer default is `preview` for compatibility with the official composer. |
| renderer → host | `COMPOSERX_SELECT {id \| null, additive?}`                                                                | Click/tap (deepest hit); additive on shift or long-press.                                                     |
| host → renderer | `COMPOSERX_SET_SELECTION {id, ids?}`                                                                      | Outline the selection (primary emphasized).                                                                   |
| renderer → host | `COMPOSERX_PROP_SPECS`                                                                                    | Per-component prop forms.                                                                                     |
| renderer → host | `COMPOSERX_MOVE_START {id, ids?}` / `MOVE_DROP {id, containerId, index, slot, ids?}` / `MOVE_CANCEL {id}` | Press-drag move; `ids` present only on a group lift.                                                          |
| renderer → host | `COMPOSERX_MARQUEE {ids}`                                                                                 | Rubber-band result (topmost-intersecting rule).                                                               |

**Gesture matrix** (edit mode, inside the iframe): component press + quick
release = select; + shift = additive; held ≥ 350 ms without moving 5 px =
additive toggle (never lifts); moved past 5 px = move lift (group lift if the
anchor is in the current selection of ≥ 2); background press + quick release =
deselect; background drag = marquee; Escape cancels a move.

---

## 4. What is coupled to the basic catalog (the six things to generalize)

These are the only places that know the basic catalog. Make them data-driven
before pointing the composer at a different renderer.

1. **Containment sets.** `apps/composer/src/lib/surface-doc.ts` line ~20
   (`CONTAINER_COMPONENTS = Row/Column/List`) and the slot names inside
   `singleSlotParentOf` (`child`, `trigger`, `content`, `tabs[].child`); used by
   `apps/composer/src/lib/tree-drop.ts` too. Renderer side:
   `apps/catalog/src/sidecar-math.ts` line ~46 and `allChildIds`. Replace with
   a per-component containment map announced by the renderer (see Phase 2).
2. **`CATALOG_ID`** constant in `surface-doc.ts` line ~10, used in
   `createSurface` and the system prompt. Take it from the catalog descriptor
   returned by `GET_CATALOG` instead.
3. **System prompt containment prose** in `apps/composer/src/chat/system-prompt.ts`
   (the paragraph naming Row/Column/List/Card/Button). Generate it from the
   containment map; the component name list is already dynamic.
4. **Glossary descriptions and tile glyphs**: `apps/composer/src/lib/descriptions.ts`
   and `GLYPHS` in `apps/composer/src/components/glossary-previews.tsx`. Move
   both into the usage metadata the renderer already sends (a `description`
   and an optional preview per component); keep the existing fallback tile.
5. **Seed content**: `apps/composer/src/lib/welcome.ts` and the recorded chat
   in `apps/composer/src/chat/recorded-client.ts` use basic-catalog components.
   Supply a per-catalog starter document (or start from an empty root
   `Column`-equivalent) and re-record the mock against the new catalog.
6. **Prop guard keys**: `GUARDED_PROP_KEYS` in `surface-doc.ts` and
   `CONTAINMENT_PROPS` in `apps/catalog/src/prop-specs.ts` list the containment
   field names. Derive them from the same containment map.

Everything else in the composer is catalog-agnostic already: component names
come from `GET_CATALOG`, snippets from `GET_COMPONENT_USAGES`, prop forms from
`COMPOSERX_PROP_SPECS`, and the sidecar's hit-testing works on any DOM that
carries the two data attributes.

---

## 5. Target profile and the two decisions to make first

Target: React, a custom styled-components theme provider, its own component
set (some outside the basic catalog), its own effects, no `@a2ui/react`, and
`@ag-ui/client` already in use.

Decide these before writing code; they change the plan:

- **Wire format.** If the target renderer consumes A2UI v0.9 (natively or
  via the A2UI-over-AG-UI custom-event binding), the composer's document model
  fits as is. If it consumes a bespoke tree such as `{type, props, children}`,
  add a **codec** (`SurfaceDoc` ↔ target shape) at two boundaries only: the
  JSON drawer and export/apply. Keep the internal model flat-with-ids; ids are
  generated on import. Recommendation: adopt A2UI v0.9 on the wire, since the
  team is already on AG-UI and agents can then emit the same JSON.
- **Prop schema source.** The inspector needs a prop spec map per component
  (`PropSpec` in `apps/catalog/src/prop-specs.ts`: kind string/number/boolean/
  enum/json, enum values, binding-capable, required). If the target components
  have zod schemas, reuse `derivePropSpecs`. If they have TypeScript types or
  JSON Schema, generate the map at build time. If nothing, hand-author one
  spec object per component next to its registry entry. The composer does not
  care where the map came from.

---

## 6. Replication plan

### Phase 0 — Set up the copy

- Copy `apps/composer/` (source, tests, `vite.config.ts`, `package.json`,
  `tsconfig.json`, `index.html`) and `packages/a2ui-bridge/` (with `NOTICE`
  and `README.md` — keep the Apache-2.0 provenance) into the target monorepo,
  plus `docs/composer/CONTRACT.md` as the contract for the port. Do not copy
  `apps/catalog/` wholesale; copy the files named in Phase 2 into the new
  preview host.
- Keep the dependency pins (`@anthropic-ai/sdk ^0.122`, React 19, zod ^3.25 if
  used). The bridge package is `workspace:*`.
- Run the copied composer tests before changing anything: they must be green
  as the baseline.

### Phase 1 — Generalize the composer (still against the copied basic catalog)

Do this as a contract change first (add a "catalog metadata" section to the
contract), then implement with tests:

1. Add a renderer → host message `COMPOSERX_CATALOG_META` carrying, per
   component, `{ childrenArrays: string[], slots: string[], slotArrays: [{field, key}] }`
   (basic catalog: `Row/Column/List → children`; `Card/Button → child`;
   `Modal → trigger, content`; `Tabs → tabs[].child`). Parse it in
   `bridge-host.ts`, store it, and replace every use of `CONTAINER_COMPONENTS`,
   `GUARDED_PROP_KEYS`, and the slot names in `surface-doc.ts` / `tree-drop.ts`
   with lookups (pass the map into the pure ops as an argument; keep them pure).
2. Read `catalogId` from the `A2UI_CATALOG` reply and use it in
   `toRenderMessages` and the system prompt.
3. Generate the system prompt's containment paragraph from the map.
4. Read tile descriptions/previews from usage metadata with the existing
   fallback; delete the two static maps when nothing depends on them.
5. Make the seed document injectable (default: empty root container).
6. Bump `SIDECAR_READY` to a new version with a `'catalog-meta'` feature.
   The composer must still work with a renderer that lacks it (fall back to
   the basic-catalog defaults) — every sidecar feature is independently
   optional by design.

Verification for this phase: all copied tests green plus new tests for the
map-driven refusals (insert into a slot, move into a moved subtree, delete a
slot occupant) using a fake catalog with a custom container.

### Phase 2 — Build the preview host in the target app (replaces `apps/catalog`)

A single route/page in the target app, served at its own URL. It needs:

1. **Bridge runtime.** Import the vendored bridge runtime. Implement the
   `RendererProcessor` interface from `packages/a2ui-bridge/src/preview-bridge.ts`
   over the target renderer: keep the current surface in React state, replace
   it on `createSurface`, apply `updateComponents`/`updateDataModel`, report
   data-model changes and action events back. Model it on
   `packages/a2ui-bridge/src/react/react-bridge.ts` (`useA2uiSandbox`), which
   is the only file that depends on `@a2ui/web_core`; your hook does the same
   job without it. If a codec is needed (section 5), it lives here.
2. **Component tagging.** Port `withComponentTag` from
   `apps/catalog/src/branded-catalog.tsx` as a HOC applied at the target
   registry's render point: a `display:contents` span with `data-a2ui-id` and
   `data-a2ui-component` around every rendered component. Components must
   render in-tree; if one portals to `body`, forward the two attributes onto
   the portal root or it will be unselectable.
3. **Sidecar.** Copy `apps/catalog/src/sidecar.ts` and `sidecar-math.ts` (and
   their tests) unchanged except for the containment source: the sidecar
   reads the same per-component containment map (make `CONTAINER_COMPONENTS`
   and `allChildIds` map-driven) and posts `COMPOSERX_CATALOG_META` right after
   `SIDECAR_READY`. Call `initComposerxSidecar()` before React mounts and
   `announceComposerxSidecarReady()` in an effect after the bridge hook's own
   effect, exactly as `apps/catalog/src/App.tsx` and `main.tsx` do.
4. **Prop specs.** Produce the `PropSpecsPayload` map (section 5) and post it
   as `COMPOSERX_PROP_SPECS`; reuse `apps/catalog/src/prop-specs.ts` if zod.
5. **Catalog descriptor + usages.** Serve a `catalog` JSON (copy the shape of
   `apps/catalog/public/catalog`: `catalogId`, `title`, `components` map) at
   the path the bridge fetches relatively, and answer `GET_COMPONENT_USAGES`
   with one insert snippet per component (shape: `apps/catalog/src/usages.ts`;
   every snippet's root id is `root` and the composer remaps ids on insert).
   Add `description` and an optional preview per usage for the glossary.
6. **Theme and effects.** Map `SET_THEME` (`light`/`dark`) onto the
   styled-components provider. Effects stay in the components. Two facts to
   respect: hover effects will not fire in Edit mode because the veil makes
   components inert (Preview mode shows them), and anything that animates
   layout mid-drag is fine because rects are re-measured every frame.
7. **Edit-mode CSS hooks.** Port the `html.composerx-edit` rules from
   `apps/catalog/src/brand.css` that give empty containers a 48px dashed
   drop zone; without them an empty custom container cannot receive drops.

Run the copied catalog tests against the host (they drive the veil with
synthetic pointer events and fake timers and do not depend on `@a2ui/react`
beyond the wrapper) and the composer against the host URL.

### Phase 3 — Chat

Copy `apps/composer/src/chat/` as is. It works immediately with a visitor's
Anthropic key. To route through the target app's agent instead, add an
`ag-ui-client.ts` implementing the interface in `llm-client.ts`: send the
prompt to the AG-UI endpoint, translate the event stream into the client's
streaming events, and let `extract-json.ts` pick up the fenced A2UI JSON the
agent emits. The system prompt builder can then feed the agent instead of the
browser SDK. `select-client.ts` decides per send; keep the recorded mock for
keyless e2e.

### Phase 4 — Tests and end-to-end drives

- Unit: everything in section 2e, ported with the code, plus the Phase 1
  additions. Hold the same bar: pure ops fully unit-tested, gesture engine
  tested with synthetic pointer events and fake timers, host parsing tested.
- End-to-end: drive the real composer + real host in Chromium with Playwright
  (a plain Node script is enough). Appendix B lists the techniques that were
  needed; `docs/VERIFICATION.md` lists the checks each wave passed. Reproduce
  at minimum: handshake, glossary drop with dashed indicator, click-select
  with inspector edit + single undo step, canvas move, tree drag, marquee →
  2 selected, group move → one undo, and the mobile flows (tap-insert, grip
  drag, long-press pair → member drag) at 390×844 with touch emulation.

### Phase 5 — Deploy

Port `deploy/composer.Dockerfile`: build the composer at `/` and the preview
host at a sub-path, guard that the catalog descriptor exists, serve with
Caddy on `$PORT`. Set the composer's default renderer URL at build time
(`VITE_RENDERER_URL`, see `apps/composer/src/lib/settings.ts` for the chain:
localStorage → env → dev localhost → `./catalog/`). No secrets in the bundle;
if chat stays browser-direct, keys live only in localStorage.

---

## 7. Hard-won gotchas (do not relearn these)

Protocol and rendering

- The renderer's zod validation is strict per batch: one invalid component
  makes the whole `updateComponents` fail silently from the user's view. Keep
  every doc the ops can produce schema-valid; the composer refuses ops that
  would break containment instead of trying and failing.
- Action `context` is a record, never an array. `updateDataModel` uses `value`.
  The upstream sample's usage snippets had both wrong (`usageHint` →
  `variant`, `primary: true` → `variant: 'primary'`); the tests in
  `apps/catalog/test/usages.test.ts` validate snippets against the schemas.
- `createSurface` remounts the surface; send the remaining items one
  macrotask later or they are lost.
- Origin verification runs on both sides; a missing `?origin=` makes the
  renderer silently ignore the host. Buffer outbound messages until
  `RENDERER_READY`.
- The sidecar (like the bridge) posts only when `window.parent !== window`,
  so a renderer opened stand-alone never emits; full round-trip tests need a
  real host page that iframes it.
- The renderer's default mode is `preview` so the official hosted composer can
  still use it as a BYO renderer; our composer sends `SET_MODE edit` on every
  handshake.

Selection and gestures

- `display:contents` wrappers have no box: rects are the union of descendant
  boxes, and Playwright's `boundingBox()` on the wrapper is null (measure a
  descendant).
- Hit-testing skips the sidecar's own layers (`[data-composerx-layer]`).
- Background hover (deepest hit null) means "append to root", so releasing a
  move outside the iframe is a valid drop into root, not a cancel. Escape is
  the cancel (the iframe owns focus during the gesture).
- Long-press (350 ms, under the 5 px threshold) is checked before the lift and
  never turns into one; the additive toggle posts immediately with a pulse.
- Group lift: the lift anchor (nearest children-array-parented ancestor of the
  press) must be in the last `SET_SELECTION` ids with ≥ 2 entries; the id list
  is snapshotted at lift time; `index` is computed after all moved ids are
  removed because the excluded view drops every moved subtree.
- Additive selects (shift-click, long-press) toggle the **movable unit** (a
  Button's label toggles the Button); otherwise a selection of slot-bound
  labels can neither group-move nor group-delete. Plain selects keep the raw
  deepest id so repeat-tap cycling can still reach inner components.
- Repeat-tap ancestor cycling applies only to plain single selects; any
  additive or marquee interaction resets the cycling seed.
- Empty containers need the 48px dashed zone in edit mode or the space is too
  small to drop back into (a real user hit this).

Composer state

- Prop commits guard against unchanged values or a blur after Enter pushes a
  second undo snapshot.
- Every applied op is exactly one undo snapshot: group delete and group move
  included. Selection is reconciled against the doc on every change (stale
  ids drop out; a group stays selected after a group move).
- Tree drag `index` is the pre-removal tree position; subtract every moved id
  that sits above the target in the same container.
- React flushes tree drag state asynchronously; synthetic DragEvent sequences
  need a shared `DataTransfer` and short waits between `dragstart`, `dragover`,
  assertion, and `drop`.

Mobile

- Keep the renderer iframe mounted across views (hide with visibility); an
  unmount replays the handshake and loses in-flight state.
- `100dvh`, 16px inputs (iOS zoom-on-focus), 44px targets,
  `touch-action: none` only on the drag grips, and tap-insert auto-switches
  back to the canvas view (drive scripts must re-open the Add view between
  inserts).
- Plain tap opens the Design view on mobile, so the breadcrumb is the mobile
  honing tool; marquee and long-press both work with touch.

Deploy

- The Dockerfile installs from manifests first for layer caching and guards
  `test -f /site/catalog/catalog` so a missing descriptor fails the build,
  not the first user.
- GitHub Pages cannot self-enable on a private repo without a paid plan; the
  container path is the reliable one.

---

## 8. Verification bar (what "done" means for the port)

Hold the replica to the same bar this repo used for every wave
(`docs/composer/CONTRACT.md` §10, `docs/VERIFICATION.md`):

- Typecheck, lint, format, unit tests green for every package; ported suites
  keep passing unmodified except where the contract legitimately changed.
- A live Playwright drive of the real composer against the real preview host
  covering the list in Phase 4, on desktop and on a 390×844 touch emulation,
  with screenshots kept under `docs/screenshots/`.
- The contract updated first for every behavior change, with the code
  following it. Message extensions stay backward-tolerant (optional fields,
  independently optional features).
- No secrets in any bundle.

---

## Appendix A — Preview host skeleton (shape only; read the real files)

```tsx
// preview/main.tsx — mirrors apps/catalog/src/main.tsx
initComposerxSidecar(); // before React mounts (copied sidecar.ts)
createRoot(el).render(
  <StrictMode>
    <PreviewHost />
  </StrictMode>,
);

// preview/PreviewHost.tsx — mirrors apps/catalog/src/App.tsx
function PreviewHost() {
  // Your replacement for useA2uiSandbox: implements RendererProcessor from
  // packages/a2ui-bridge/src/preview-bridge.ts over YOUR renderer, and passes
  // getComponentUsages + onCatalogResolved + onSurfaceReady the same way
  // packages/a2ui-bridge/src/react/react-bridge.ts does.
  const { surface } = usePreviewHost(taggedRegistry, { getComponentUsages });
  useEffect(() => {
    announceComposerxSidecarReady(); /* then CATALOG_META, PROP_SPECS */
  }, []);
  return (
    <ThemeProvider theme={themeFromBridge()}>
      {' '}
      {/* SET_THEME → light/dark */}
      {surface ? <YourRenderer surface={surface} /> : <p>Waiting for RENDER_A2UI…</p>}
    </ThemeProvider>
  );
}

// taggedRegistry = registry.map(withComponentTag)   // display:contents + data-a2ui-id/-component
```

## Appendix B — End-to-end driver techniques that were needed

- Launch Chromium via Playwright from a plain Node script; abort Google Fonts
  routes in sandboxed CI; `page.frameLocator('iframe[title="A2UI renderer"]')`
  for renderer content.
- Click through the edit veil with `force: true`; modifiers `['Shift']` for
  additive selects.
- Lifts: `mouse.down()`, `mouse.move(..., {steps})` past 5 px within 350 ms,
  more moves, `mouse.up()`. Long-press: `mouse.down()`, wait ≥ 500 ms, `mouse.up()`.
- Marquee: start on background **inside** the iframe (below the rendered
  content; full-width components leave no side margin), sweep, assert the
  band and live candidates before `mouse.up()`.
- Mid-drag assertions run in the iframe frame: ghost label
  `[data-composerx-move="ghost-label"]`, origins
  `[data-composerx-move="origin"][data-composerx-move-id]`, indicators
  `[data-composerx-indicator]`, outlines
  `#composerx-selection-layer [data-composerx-outline]`, marquee
  `[data-composerx-marquee="band"|"candidate"]`.
- Document assertions: open the Layout JSON drawer and parse the
  `[data-testid="json-editor"]` value rather than reading the tree DOM.
- Tree drags: dispatch `DragEvent`s with one shared `DataTransfer` and ~60 ms
  waits between steps; testids `tree-node-<id>`, `tree-row-<id>`,
  `tree-drop-indicator`.
- Mobile: context `{ viewport: {width: 390, height: 844}, isMobile: true,
hasTouch: true }`, coordinate taps via `touchscreen.tap`, testids
  `mtab-canvas|add|design|chat`, `glossary-tile-<Name>`, `glossary-grip-<Name>`,
  `mtoast`, `inspector-multi`, `crumb-<id>`.
