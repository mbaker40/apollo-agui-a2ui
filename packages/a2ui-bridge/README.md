# a2ui-bridge (vendored)

Renderer-side source of the A2UI Composer **Preview Bridge**, vendored from
the official composer repository because the package is not published to npm
(its in-repo `package.json` is `"private": true`; the official samples consume
it through a yarn workspace).

- **Upstream**: https://github.com/a2ui-project/composer — `bridge/src/` at
  commit `40463c8c533361ba62f92e1d8edb5450cfb4297e` (2026-08-31)
- **License**: Apache-2.0 (see `NOTICE`; every file keeps its upstream
  copyright header)
- **Scope**: framework-agnostic core plus the React adapter only. The
  upstream `lit/` and `angular/` adapters are not vendored.

## Exports

| Subpath                      | Contents                                                              | Side effects                                            |
| ---------------------------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| `a2ui-bridge`                | everything (message types, `PreviewBridge`, origin verification, ...) | **yes** — instantiates the `window.a2uiBridge` singleton |
| `a2ui-bridge/messages`       | `PreviewBridgeMessageType` enum + payload interfaces                  | none                                                    |
| `a2ui-bridge/render-config`  | `ComponentUsages`, `RendererConfig`, surface types                    | none                                                    |
| `a2ui-bridge/react`          | `useA2uiSandbox` hook (pulls in the singleton)                        | **yes**                                                 |

The **composer host app must import only the side-effect-free subpaths**
(`/messages`, `/render-config`): importing the root would install a renderer
message listener inside the host window. The catalog app (which *is* the
renderer) imports `a2ui-bridge/react` exactly like the official
`react-basic-catalog` sample, so it stays drop-in compatible with the official
hosted composer.

## Local modifications

Kept deliberately minimal so a future upstream sync is a re-copy plus this
list:

1. `preview-bridge.ts` — the unrecognized-incoming-message warning ignores
   types prefixed `COMPOSERX_` (our drag-and-drop sidecar shares the
   postMessage channel; see `docs/composer/CONTRACT.md`).

This package is exempted from the repo's Prettier/ESLint runs
(`.prettierignore`, `eslint.config.mjs`) to keep the diff against upstream
readable.
