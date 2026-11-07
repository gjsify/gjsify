# gjsify documentation

Reference material for the root [`AGENTS.md`](../AGENTS.md). Read the AGENTS.md that owns your subtree first, then come here for detail on cross-cutting topics.

## Governance and process

| Document | What it covers |
|---|---|
| [`governance.md`](governance.md) | Long-form governance reasoning, required checks, merge queue, manifest-conformance registry, agent-context budget |
| [`runtime-platform-axes.md`](runtime-platform-axes.md) | The four-axis runtime/OS/headless/build model and the incidents behind the rules |
| [`code-anti-patterns.md`](code-anti-patterns.md) | Measured anti-patterns and the incidents that produced each rule |
| [`package-convention.md`](package-convention.md) | Layout, exports, `sideEffects`, scripts and release-train conventions for `@gjsify/*` packages |
| [`implementation-workflow.md`](implementation-workflow.md) | The TDD porting workflow for Node/Web/DOM APIs |
| [`commit-conventions.md`](commit-conventions.md) | Conventional commits, squash-only `main`, `commitlint` and the repair job |
| [`pr-workflow.md`](pr-workflow.md) | PR size, draft/batch workflow, native stacks and how to read CI status |
| [`constraints.md`](constraints.md) | Target environment, TypeScript version invariant and engine baseline |

## Build, ship and publish

| Document | What it covers |
|---|---|
| [`build-artifacts.md`](build-artifacts.md) | The git hook, bundle freshness and what an exit code proves |
| [`prebuilds.md`](prebuilds.md) | Native extensions and prebuilds |
| [`publishing.md`](publishing.md) | First-publish bootstrap, release closure and the `next` channel |
| [`consuming-the-next-channel.md`](consuming-the-next-channel.md) | Running an app against `main` |
| [`bundled-toolchains.md`](bundled-toolchains.md) | Axis 6 bundled toolchains |
| [`ship-formats.md`](ship-formats.md) | `.deb`, `.rpm`, Flatpak and one-line installer output |

## CI, lint and code quality

| Document | What it covers |
|---|---|
| [`ci-selective.md`](ci-selective.md) | Selective CI and why some workflows are advisory |
| [`lint-format.md`](lint-format.md) | Lint and format setup |
| [`register-convention.md`](register-convention.md) | The `/register` subpath convention |
| [`engine-baseline.md`](engine-baseline.md) | What SpiderMonkey 140 gives beyond ES2024 |

## Platform and runtime specifics

| Document | What it covers |
|---|---|
| [`gnome-mappings.md`](gnome-mappings.md) | GNOME library ↔ API mapping table |
| [`node-gi-gjs-surface.md`](node-gi-gjs-surface.md) | The `node-gi` GJS surface |
| [`node-gi-platform-notes.md`](node-gi-platform-notes.md) | `node-gi` platform notes |
| [`node-gi-verification.md`](node-gi-verification.md) | `node-gi` verification |
| [`node-os-constants.md`](node-os-constants.md) | Node OS constants |
| [`node-timers-handles.md`](node-timers-handles.md) | Node timers handles |
| [`optional-gi-namespaces.md`](optional-gi-namespaces.md) | Optional GI namespaces |
| [`nativescript-real-gobject.md`](nativescript-real-gobject.md) | NativeScript real GObject bridge |
| [`nativescript-platform-notes.md`](nativescript-platform-notes.md) | NativeScript platform notes |
| [`nativescript-icons.md`](nativescript-icons.md) | NativeScript icons |
| [`nativescript-shell-trees.md`](nativescript-shell-trees.md) | NativeScript shell trees |
| [`nativescript-xml.md`](nativescript-xml.md) | NativeScript XML |
| [`nativescript-fdroid-recipe.md`](nativescript-fdroid-recipe.md) | F-Droid metadata draft for the NativeScript Android sample |
| [`react-layers.md`](react-layers.md) | React layers |
| [`react-native-gtk-measurements.md`](react-native-gtk-measurements.md) | React Native GTK measurements |
| [`worker-url.md`](worker-url.md) | Worker URL handling |

## Reference material and status

| Document | What it covers |
|---|---|
| [`references.md`](references.md) | `refs/` submodules, attribution and how to use them |
| [`attribution.md`](attribution.md) | Attribution |
| [`status-changelog.md`](status-changelog.md) | Status data, `STATUS.md` generation and the open-TODO ledger |
| [`examples-showcases.md`](examples-showcases.md) | Examples and showcases |

## ADRs

Architectural decisions live under [`adr/`](adr/) (numbered, MADR-style).
