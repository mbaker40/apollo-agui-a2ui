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
- Components are a **flat id-referenced list**: `{id, component, ...props}`.
  Containment (verified against `@a2ui/web_core@0.10.6` zod schemas — these
  are strict, and one bad component fails the whole `updateComponents`
  batch): `children: [ids]` exists ONLY on **Row/Column/List**; **Card** and
  **Button** take a single REQUIRED `child: id`; **Modal** takes
  `trigger: id` + `content: id`; **Tabs** takes
  `tabs: [{title, child: id}]`. The root component has `id: "root"`.
- Data binding: prop values of the form `{"path": "/some/path"}`.
- Actions: `"action": {"event": {"name": "...", "context": {...}}}` —
  `context` is a **record** (`z.record`), never an array; the renderer
  rejects the array form at render time.
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
  payload: { features: ['dnd-hittest', 'select', 'prop-specs', 'move', 'multi-select', 'group-move'], version: 5 } }
```

(Version 1 announced `['dnd-hittest']` only; version 2 lacked `'move'`. The
composer must treat every feature as independently optional — check the
array, not the version.)

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

Semantics: `'into'` targets are exactly the **children-array containers**
(Row/Column/List — see §3 containment): hovering one's interior →
`slot:'into'`, `containerId` = that component, `index` = end (or
between-children position if determinable). Hovering anything else —
leaves AND single-slot components (Card/Button/Modal/Tabs) — resolves to
the nearest ancestor holding a `children` array, `slot:'before'|'after'`
by pointer position along that ancestor's main axis, `index` accordingly.
(Single-slot interiors stay editable via JSON/chat; drag-into them is
deliberately not offered.) The **catalog side owns hit-testing
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

### 4b. Drop-indicator styling (Figma-like, catalog-rendered)

The catalog's indicator layer draws, during a drag:

- `'before'`/`'after'` → a **dashed accent insertion line** (2px dashed
  `--brand-accent` with rounded end-caps rendered as small dots) at the
  caret rect, plus a faint dashed outline around the container it splices
  into;
- `'into'` → a **dashed accent outline** (2px dashed, 6px radius) around
  the container rect with a very light accent wash inside;
- no target → nothing.

Everything clears on `COMPOSERX_DND_END`. The layer stays
`pointer-events: none`, `overflow: hidden`, and never affects
`SURFACE_RESIZE`.

**Empty-container drop zones**: an empty Row/Column/List renders at
near-zero size, which would make dropping (back) into it impossible — so
in edit mode (the sidecar toggles `composerx-edit` on `<html>`) empty
children-array containers get a minimum 48px dashed placeholder box.
The box is real geometry, so `elementsFromPoint` hit-testing resolves
hovers `'into'` it like any container. Preview mode renders untouched.

### 4c. Selection + edit mode (sidecar v2)

The canvas doubles as a live preview, so interactivity is modal. Composer →
catalog:

```ts
{ type: 'COMPOSERX_SET_MODE', payload: { mode: 'edit' | 'preview' } }
{ type: 'COMPOSERX_SET_SELECTION', payload: { id: string | null } }
```

- Default mode (before any SET_MODE) is **`preview`** — a COMPOSERX-unaware
  host (the official hosted composer, §1) must get a fully interactive
  standard renderer. Our composer sends `SET_MODE {mode:'edit'}` in every
  post-ready handshake, so its canvas is in edit mode from first paint.
- In **edit** mode the sidecar intercepts pointer interactions on the
  rendered surface in the capture phase (click AND mousedown-level
  suppression of component behavior — a Button must not fire its action, a
  TextField must not take typed input) and posts the deepest hit id:

```ts
{ type: 'COMPOSERX_SELECT', payload: { id: string | null } }
// null = background click (deselect)
```

The composer is the source of truth: it updates its selection state and
answers with `COMPOSERX_SET_SELECTION`, which the catalog renders as a
**solid 2px accent outline** (offset 1px) around that component's rect —
dashed is reserved for drop indicators. In edit mode the sidecar also
draws a subtler **1px accent hover outline** under the pointer (local,
no messages). Selection outlines re-anchor after every `RENDER_A2UI`
(re-measure by id; if the id no longer renders, clear the outline —
the composer clears stale selection on its side).

- In **preview** mode: no interception, no hover/selection outlines
  drawn (selection state is retained composer-side), components behave
  live exactly as before (actions → `SEND_TO_SERVER`).

### 4d. Prop specs (schema-derived, catalog → composer)

So the composer's inspector can render true forms without depending on the
renderer's schema library, the catalog derives per-component prop specs
from `@a2ui/web_core`'s zod schemas at runtime and sends them once after
`SIDECAR_READY`:

```ts
{ type: 'COMPOSERX_PROP_SPECS', payload: {
    components: Record<string, { props: PropSpec[] }>,
} }
// PropSpec = {
//   name: string;
//   kind: 'string' | 'number' | 'boolean' | 'enum' | 'json';
//   options?: string[];        // kind 'enum'
//   required?: boolean;
//   bindable?: boolean;        // union with {path} — value may be a binding
//   containment?: boolean;     // children/child/trigger/content/tabs — read-only in the inspector
// }
```

Derivation walks each component schema's shape (unwrap
optional/default/nullable; union of literal-type-or-`{path}`-object →
base kind + `bindable`; enum → options; anything unrecognized → `'json'`).
Containment props are marked, never widget-edited. A renderer without this
feature (official sample) sends nothing and the composer falls back to
generic JSON prop rows.

### 4e. Canvas move (feature `'move'`, edit mode only)

Press-and-drag on an already-rendered component moves it — the Figma lift.
The whole drag happens **inside the iframe** on the edit veil (plain
pointer events with `setPointerCapture`, no HTML5 DnD, no composer
overlay); only three messages cross the frame:

```ts
// catalog → composer
{ type: 'COMPOSERX_MOVE_START',  payload: { id: string } }
{ type: 'COMPOSERX_MOVE_DROP',   payload: {
    id: string, containerId: string, index: number,
    slot: 'before' | 'after' | 'into' } }
{ type: 'COMPOSERX_MOVE_CANCEL', payload: { id: string } }
```

- **Start**: pointerdown on a component + movement past a ~5px threshold.
  A sub-threshold pointerup stays a click (→ `COMPOSERX_SELECT`, §4c);
  once a move has started, the click-derived SELECT for that gesture is
  suppressed.
- **Lift anchor**: climb from the deepest hit to the nearest component
  whose parent reference is a **children-array splice** — pressing a
  Button's label lifts the Button; pressing a Card's slot-bound interior
  lifts the Card. If no such ancestor exists (root itself), no move
  starts. `MOVE_START` carries the lift target's id (the composer selects
  it).
- **During the drag** the catalog renders: a translucent ghost following
  the pointer (a cloned box or an accent-bordered rect labeled with the
  component type — implementer's choice), the origin rect dimmed with a
  dashed outline, and the §4b dashed drop indicators driven by the same
  hit-test path — with the **moved subtree excluded from target
  resolution** (hovering it resolves as if those nodes were absent).
- **Drop**: pointerup with a resolved target → `MOVE_DROP` with the same
  `containerId`/`index`/`slot` semantics as §4's DND_TARGET, where
  `index` is the position in the container's children **after the moved
  id is removed** (see §5). Pointerup with no valid target, or Escape
  mid-drag (handled catalog-side — the iframe owns focus during the
  gesture), → `MOVE_CANCEL`; all visuals clear either way.
- The **composer stays authoritative**: it validates the drop
  (`canMoveTo`, §5) and applies `moveComponent` — or ignores an invalid
  one (the catalog does not mutate anything itself). No sidecar / no
  `'move'` feature → no canvas move; the layout-tree drag (§7) is the
  fallback.

**Group move (feature `'group-move'`, sidecar v5)** — the Figma behavior:
pressing a component that is a **member of the current multi-selection**
lifts the whole selection; pressing a non-member keeps today's behavior
(collapse to a single move). Backward-tolerant message extension — the
three §4e messages gain an optional `ids`:

```ts
{ type: 'COMPOSERX_MOVE_START', payload: { id, ids?: string[] } }
{ type: 'COMPOSERX_MOVE_DROP',  payload: { id, containerId, index, slot, ids?: string[] } }
// MOVE_CANCEL unchanged. A v4 composer ignores ids (single move of id);
// the catalog sends ids ONLY when a group lift happened.
```

- **Group-lift decision (catalog)**: resolve the lift anchor as in §4e;
  if that anchor is in the ids of the last received
  `COMPOSERX_SET_SELECTION` AND that list has ≥ 2 entries → group lift
  with `ids` = that list (the pressed anchor stays `id`, the grab
  handle). Otherwise single lift exactly as before. Long-press/threshold
  timing is unchanged (§4f): press-and-hold still toggles; only an
  immediate drag lifts.
- **During a group drag** the catalog dims EVERY moved origin rect,
  excludes EVERY moved subtree from target resolution, and labels the
  ghost with the count (e.g. "3 components"). The emitted `index` is the
  position after ALL moved ids are removed (the excluded view makes this
  automatic, as in §4e).
- **Composer semantics on `MOVE_DROP` with `ids`**: filter `ids` to the
  current doc, reduce by subsumption (a selected proper ancestor carries
  its selected descendants), skip unmovable members (root, single-slot
  occupants — reported via the toast, like group delete), keep the rest
  in **document order**, and apply `moveComponents` (§5): all removed,
  then inserted as one **contiguous run** at the resolved index — ONE
  undo snapshot. If the effective set is empty or the target is invalid
  for the group, the drop is refused (log; doc untouched). `MOVE_START`
  with `ids` does NOT collapse the selection (it stays the group).
- **Tree drag** follows the same rule: dragging a row that is in the
  multi-selection group-moves the whole selection (pre-removal tree
  indexes adjusted for every moved id above the target in the same
  container); dragging an unselected row collapses and moves just it.

### 4f. Marquee + multi-select (feature `'multi-select'`, edit mode)

The selection becomes a **list**; the composer stays authoritative. Three
message changes (all backward-tolerant — a v3 catalog simply never sends
or reads the new fields):

```ts
// catalog → composer: click/tap select gains an additive flag
{ type: 'COMPOSERX_SELECT', payload: { id: string | null, additive?: boolean } }
// additive=true when shift is held during the click, OR on a touch
// long-press (~350ms press without crossing the 5px move threshold —
// checked BEFORE the §4e lift starts; a long-press therefore never lifts).

// catalog → composer: marquee result on pointerup
{ type: 'COMPOSERX_MARQUEE', payload: { ids: string[] } }   // [] clears

// composer → catalog: outline every selected id
{ type: 'COMPOSERX_SET_SELECTION', payload: { id: string | null, ids?: string[] } }
// `id` stays the primary (back-compat: a v3 catalog outlines just it);
// a v4 catalog outlines every id in `ids`, the primary emphasized
// (2px solid accent) and the rest lighter (1.5px solid, 70% accent).
```

**Marquee gesture** (edit mode, veil-owned, mouse and touch alike):
pointerdown on the **background** (deepest hit null) + movement past the
5px threshold starts a marquee; a sub-threshold background pointerup
stays the existing deselect click. During the drag the catalog draws the
rubber band (1px solid accent border, ~8% accent fill — solid, NOT
dashed: dashed is reserved for drop indicators) and live-highlights the
current candidates; Escape or pointercancel aborts (no message). On
pointerup it posts `COMPOSERX_MARQUEE` with the candidate ids.

**Candidate rule (topmost-intersecting)**: candidates are components
whose rect intersects the marquee rect, MINUS any whose ancestor (via
the full reference edges) is itself a candidate — sweeping across a Card
yields the Card, never the Card plus its subtree. The root component is
never a candidate. Order: document order (flat-list order).

**Composer semantics**: selection state is `selectedComponentIds:
string[]` (ordered, deduped; primary = first). `additive` SELECT toggles
the id in/out of the list; plain SELECT replaces the list with `[id]`
(the §7 repeat-tap ancestor cycling applies ONLY to plain single
selects). MARQUEE replaces the list. Escape and background click clear
the whole list. Doc changes filter out stale ids. Every selection change
re-sends SET_SELECTION with `{id: primary, ids}`.

**Multi-aware surfaces**: the tree highlights every selected row
(shift-click toggles there too); the inspector shows a multi-state
("N selected" + component-type summary, testid `inspector-multi`) with
**Delete** (all deletable selected ids in ONE undo snapshot — descendants
of another selected id are subsumed, single-slot occupants are skipped
and reported via toast/hint, testid `inspector-multi-delete`) and a
Clear-selection button. Prop editing remains single-selection.
**Moving is group-aware** (§4e group move): a §4e lift or a tree drag on
a MEMBER of the multi-selection moves the whole selection as one
contiguous run (one undo step); on a non-member it collapses to the
pressed component and moves just it. Glossary insert targets derive from
the primary.

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
  at the target index. Valid insert targets are exactly the
  children-array containers of §3 (Row/Column/List) — never Card / Button /
  Modal / Tabs slots. Merge `ComponentUsage.data` into `doc.dataModel`
  (shallow, existing keys win). No orphan components: every non-root
  component is reachable from `root`.
- **Prop ops** (inspector): `setComponentProp(doc, id, key, value)` and
  `removeComponentProp(doc, id, key)` — reject `id`/`component` and the
  containment keys (`children`, `child`, `trigger`, `content`, `tabs`);
  everything else is fair game, values are arbitrary JSON. One undo
  snapshot per committed edit (text fields commit on blur/Enter, discrete
  widgets on change — never per keystroke).
- **Remove op** (inspector Delete / Delete key): `removeComponent(doc, id)`
  removes the component and its entire subtree, splicing its id out of the
  parent's `children` array. It throws for `root` and for any component
  whose parent reference is a **single slot** (`child`, `trigger`,
  `content`, `tabs[].child`) — deleting the occupant would leave the
  parent schema-invalid, so the inspector disables Delete there with a
  hint ("delete the parent, or edit via JSON"). Every doc the op can
  produce stays schema-valid.
- **Move op** (canvas move §4e + tree drag §7):
  `moveComponent(doc, id, containerId, index)` re-homes the component and
  its entire subtree — no id remapping, `dataModel` untouched: splice `id`
  out of its current parent's `children`, then splice it into
  `containerId`'s `children` at `index`, where `index` is interpreted
  **after the removal** (so a same-container reorder needs no caller-side
  adjustment; out-of-range indices clamp). It throws for: `root`; an
  unknown `id` or `containerId`; a `containerId` outside the §3
  children-array container set; a component whose parent reference is a
  **single slot** (same rule and reason as the remove op); and a
  `containerId` that is `id` itself or anywhere inside `id`'s subtree
  (would orphan the branch). `canMoveTo(doc, id, containerId)` exposes the
  same checks as `{ok: true} | {ok: false, reason}` for UI affordances —
  both drag surfaces consult it instead of try/catching.
- **Group move op** (§4e group move + tree group drag):
  `moveComponents(doc, ids, containerId, index)` — the plural of
  `moveComponent` with the same target rules. Effective set: `ids`
  filtered to the doc, subsumption-reduced (a proper ancestor in the set
  carries its descendants), unmovable members (root, single-slot
  occupants) split out as `skipped`, remainder kept in **document
  order**. All effective ids are spliced out first, then inserted as one
  contiguous run at `index` interpreted **after every removal**
  (clamped). Refusals (throw): empty effective set; a `containerId`
  outside the container set, unknown, or inside ANY moved subtree.
  Returns the new doc plus the `skipped` list so callers can toast.
  `canMoveGroupTo(doc, ids, containerId)` exposes the same checks for UI
  affordances. Exactly ONE undo snapshot per applied group move.
- Undo/redo: bounded snapshot stack of serialized docs (50 entries) —
  every applied insert/JSON-apply/chat-apply/prop-commit/remove/move
  pushes one.
- All ops are pure functions in `src/lib/surface-doc.ts` with unit tests
  (id remap, splice positions, orphan invariant, round-trip
  parse(serialize(doc)) === doc, prop guards, remove-subtree behavior,
  move semantics incl. same-container reorder and subtree/slot refusals).

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
toggle, **Edit/Preview mode toggle**, renderer URL indicator), **right
sidebar with two tabs: Design / Chat** (Figma-style). Bottom drawer with
tabs: **Layout JSON** (editable textarea + Apply/Format/Reset, error
surface on invalid JSON), **Data model** (read-only pretty JSON, live via
DATA_MODEL_CHANGE), **Events** (SEND_TO_SERVER / CONSOLE_LOG / bridge
lifecycle, newest first, cap 200). Canvas shows a "waiting for renderer"
state until RENDERER_READY and an error state if the iframe never
handshakes (10s timeout with the renderer URL shown).

**Glossary (visual tiles)**: each of the 18 components renders as a tile
with a **stylized mini-preview** of the component (hand-built CSS/SVG
glyphs styled with the same brand tokens — a violet pill for Button, a
card outline for Card, text lines for Text, a track+thumb for Slider, …;
theme-aware) above the name; description via `title` tooltip. Tiles stay
HTML5 `draggable`; `dragstart` calls `setDragImage` with the tile's
preview element so **the visual itself is what you drag**. Click still
inserts into the current insert target (keyboard/no-sidecar path).

**Selection (Figma-like)**: one selection shared by canvas clicks (sidecar
`COMPOSERX_SELECT`, §4c), LayoutTree clicks, and the inspector. The
insert target derives from it: the selected component if it's a
children-array container, else its nearest container ancestor, else root.
Selecting auto-switches the right sidebar to **Design**; Escape or a
background click deselects. Stale ids (after undo/JSON apply/chat apply)
clear the selection. The selection is a **list** (§4f): marquee from
empty canvas, shift-click (web) / long-press (touch) toggling, and
shift-click in the tree build multi-selections; the inspector's
multi-state carries the group Delete. Prop editing, canvas move, and
tree reordering operate on the primary/single selection only.

**Ancestor honing** (parents are otherwise untappable — a canvas tap
always hits the deepest component). Three mechanisms, composer-side only
(the catalog keeps sending the deepest hit id; no protocol change):

- **Repeat-tap cycling**: the store keeps the last canvas hit id. When a
  `COMPOSERX_SELECT` arrives with the SAME id as the previous one AND the
  current selection is in that id's inclusive ancestor chain, selection
  moves one ancestor up (deepest → … → root, then wraps back to the
  deepest); each step re-sends `SET_SELECTION` so the canvas outline
  shows the current layer. Any other id (or a null/background tap, or a
  selection made elsewhere in the meantime) resets the cycle and selects
  normally. Works identically for taps and clicks.
- **Inspector breadcrumb**: the Design header shows the full ancestor
  path (`root › Card › Column › Text`; testid `crumb-<id>` per chip,
  horizontally scrollable under the mobile breakpoint); tapping a crumb
  selects that ancestor. Next to Delete sits a **select-parent button**
  (testid `inspector-parent`, disabled on root).
- **Tree follows selection**: whenever the selection changes, the layout
  tree scrolls the selected node into view (`scrollIntoView` with
  `block:'nearest'`), so the hierarchy is always one glance away on
  mobile.

**Moving placed components** — two drag surfaces over the same §5 move op,
each one undo step:

- **Canvas move** (§4e, edit mode, sidecar feature `'move'`): press and
  drag a rendered component; the catalog lifts it (ghost + dimmed origin +
  §4b dashed indicators), the composer receives `MOVE_START` (selects the
  component and shows a status hint), validates `MOVE_DROP` via
  `canMoveTo`, and applies `moveComponent`. Invalid drops and
  `MOVE_CANCEL` change nothing.
- **Layout-tree drag** (works with ANY renderer, sidecar or not): every
  tree row is draggable. Hovering a row resolves by thirds — upper third
  → before it in its parent, lower third → after, middle third → into it
  (only when the row is a children-array container; otherwise the middle
  behaves as before/after by half). Indicators reuse the dashed language:
  a dashed insertion line between rows, a dashed outline on an 'into'
  row. Targets rejected by `canMoveTo` (own subtree, single-slot
  occupants, non-containers for 'into') render as no-drop and refuse the
  drop. Tree rows ALSO accept glossary-tile drags with the same
  position resolution, inserting the usage snippet at that spot (§5
  insert op with an explicit index).

**Design tab (inspector)**: empty-state hint when nothing is selected;
otherwise: component type + id header, widget-per-prop form driven by
`COMPOSERX_PROP_SPECS` (§4d — text inputs commit on blur/Enter, enum
selects/checkboxes/number steppers on change; a binding toggle for
`bindable` props switching the widget to a `{path}` input), a raw
"advanced" JSON section for props without a spec (and the whole form
falls back to JSON rows when no specs arrived), containment props
displayed read-only, and a **Delete** button (disabled with a hint for
single-slot occupants, per §5). Every commit re-renders the canvas and is
one undo step. Delete/Backspace on the host document (when focus is not
in an input) deletes the selection under the same §5 rules.

**Mode toggle**: Edit (default) = canvas clicks select, components inert
(§4c); Preview = live components, actions flow to the event log, no
outlines. Mode is composer state (not persisted), re-sent on handshake.

Settings (gear): renderer URL (default per §9, BYO renderer supported),
Anthropic API key (password field), model picker. Persisted in
localStorage under keys `composerx.rendererUrl`, `composerx.apiKey`,
`composerx.model`, `composerx.theme`.

### 7b. Mobile layout + touch (breakpoint ≤ 900px)

Audit findings that drove this (phone viewport 390×844): canvas and iframe
collapse to **0px** (fixed 250px + 330px side panels), 190px horizontal
page scroll, several tap targets < 44px, sub-16px inputs (iOS
zoom-on-focus), `100vh` under the URL bar, and HTML5 drag events never
fire from touch (glossary + tree drags dead; the canvas-move gesture is
pointer-based and survives).

- **Single-column app** under the breakpoint: the canvas fills the screen;
  a fixed **bottom tab bar** switches views — `Canvas · Add · Design ·
Chat` (testids `mtab-canvas` etc.), ≥ 48px tall rows, padded by
  `env(safe-area-inset-bottom)`. Glossary becomes the Add view; the right
  sidebar's Design/Chat become their own views; the bottom drawer stays
  reachable from the Canvas view (its toggle; default **closed** on
  mobile). The desktop ≥ 900px layout is unchanged. CRITICAL: the
  renderer iframe must stay **mounted** across view switches (hide the
  canvas view with CSS, never unmount — remounting reboots the renderer
  and replays the handshake).
- **Sizing hygiene** (applies globally, hurts nothing on desktop): app
  height `100dvh` with a `100vh` fallback; every text/number/password
  input and textarea ≥ 16px font on mobile; interactive controls ≥ 44px
  hit area under the breakpoint (visual size may stay smaller via
  padding); no horizontal page scroll ever (assert
  `document.documentElement.scrollWidth <= clientWidth`); toolbar
  compacts (smaller labels / horizontal scroll within the toolbar strip,
  never page overflow).
- **Touch insertion, two tiers**: (1) **tap a glossary tile** = insert
  into the current insert target, auto-switch to the Canvas view, and
  show a brief toast naming what landed where (`mtoast` testid;
  auto-dismiss ~2.5s). (2) **Positional touch drag** via a per-tile
  **drag grip** (`glossary-grip-<Name>`, a ≥ 44px handle with
  `touch-action: none` — the tile body keeps `pan-y` so the list still
  scrolls): pointerdown on the grip starts a pointer-based drag
  immediately (no long-press) — a floating tile ghost follows the
  pointer, the app auto-switches to the Canvas view when the pointer
  crosses into it, converts coordinates and drives the SAME
  `sendDndHover`/`sendDndEnd` + held `COMPOSERX_DND_TARGET` path as the
  desktop overlay (the catalog side needs no changes), and pointerup
  inserts at the resolved target (structural fallback rules unchanged).
  HTML5 drag stays as-is for desktop; the pointer path is additive and
  must also work with a mouse under the breakpoint.
- **Tree** on mobile: tap-select only (HTML5 row drag remains
  desktop-only; document it). **Canvas move** (§4e) already rides pointer
  events on the veil — it must keep working under touch emulation
  (verified in the wave e2e), giving mobile its move gesture.
- Settings modal renders full-screen under the breakpoint. Tooltips
  (`title`) don't exist on touch — the toast + visible hint text carry
  the affordances instead.

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
