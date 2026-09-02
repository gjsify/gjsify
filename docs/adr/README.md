# Architecture Decision Records (ADR)

Cross-cutting architecture decisions for the gjsify ecosystem — decisions that span
multiple packages/pillars, change a workspace invariant, or bind the ecosystem's
consumers (easy6502, pixel-rpg/map-editor, ts-for-gir).

Per-package decisions do NOT need an ADR — they follow the normal AGENTS.md +
status-data governance. An ADR is warranted when a decision (a) affects more than one pillar or
repo, (b) changes a published contract (versioning, tiering, artifact strategy), or
(c) deliberately scopes/limits a whole track (e.g. node-gi).

## Format

MADR-style, one file per decision: `NNNN-<slug>.md` with `Status` / `Context` /
`Decision` / `Consequences` / `Implementation` sections. Statuses: `Proposed`,
`Accepted`, `Superseded by NNNN`, `Rejected`. An accepted ADR's follow-up work is
tracked in `status/open-todos.md` (per governance); the ADR records the *why*,
the TODO records the *what's left*.

## Index

| ADR | Title | Status |
|---|---|---|
| [0001](0001-install-clean-separation.md) | `gjsify install` is non-destructive — install/clean separation (amended) | Accepted |
| [0002](0002-bootstrap-bundle-minimization.md) | Minimize committed bootstrap bundles — the previous release supplies the toolchain, never the installer (amended) | Accepted |
| [0003](0003-package-tiering.md) | Explicit package tiering (stability contract) | Accepted |
| [0004](0004-headless-adwaita-core.md) | Headless Adwaita core — share widget behavior across renderers | Accepted |
| [0005](0005-node-gi-scope.md) | node-gi (Axis 5) stays experimental and dependency-isolated | Accepted |
| [0006](0006-per-package-build-artifacts.md) | Per-package build cache; publish-time-only lib builds (spike) | Accepted |
| [0007](0007-web-pillar-common-ui.md) | Web targets implement the shared controller/view layer (experiment) | Accepted |
| [0008](0008-release-versioning-policy.md) | Release-train versioning policy for `@gjsify/*` | Accepted |
| [0009](0009-native-adwaita-app-shell.md) | Native Adwaita app shell — extract the GTK application shell | Accepted |
| [0010](0010-adwaita-web-style-isolation.md) | adwaita-web style isolation — light-DOM boundary reset + token contract | Accepted |
| [0011](0011-napi-host-in-gjs.md) | N-API host in GJS (`@gjsify/napi`) | Accepted |
| [0012](0012-framework-register-ownership.md) | Global registration ownership for GTK/WebKit-backed DOM classes | Accepted |
| [0013](0013-sab-native-platform-scope.md) | `@gjsify/sab-native` stays address-keyed; Linux ships, macOS is the one reachable port, Windows is blocked | Accepted |
| [0014](0014-utils-core-subpath-and-platform-entry-routing.md) | Cross-runtime reachability — `@gjsify/utils/core` subpath, `polyfill`-slot platform-entry routing, machine-checked invariant | Accepted |
| [0015](0015-headless-package-contract.md) | Headless package contract — `gjsify.headless` as a declared, machine-checked promise about the root entry | Accepted |
| [0016](0016-status-as-data.md) | Status as data — authored status data (`status/`) + derived facts, gated by the `status-data` conformance rule; the rendered STATUS.md is generated, not committed (amended) | Accepted |
| [0017](0017-native-package-distribution.md) | Distribution of platform-specific native builds — per-target packages behind an `optionalDependencies` bridge | Accepted |
| [0018](0018-os-axis-declaration.md) | The OS axis is a declared, checked claim; Linux + macOS + Windows are the target | Accepted |
| [0019](0019-ts-for-gir-as-library.md) | ts-for-gir as a library; the `.gir` travels with the runtime package | Proposed |
| [0020](0020-engine-as-optional-dependency.md) | The GJS engine set becomes an `optionalDependencies` edge of `@gjsify/cli` | Proposed |
| [0021](0021-launcher-free-prebuild-resolution.md) | Native prebuilds resolve in-process via girepository's own search paths; the launcher becomes an optimisation | Accepted |
| [0022](0022-webkit-on-darwin.md) | `@gjsify/iframe` on macOS — Apple's WebKit behind a GObject shim that answers to `gi://WebKit` 6.0 | Accepted |
| [0023](0023-gtk-source-precedence.md) | Which GTK a node-gi process uses: the app author installs a bundle, a per-OS policy decides, a from-source addon never gets one | Accepted |
| [0024](0024-ship-installable-artifacts.md) | `gjsify ship` — one payload, a runtime policy derived per OS, several install formats; `gjsify flatpak` migrates under it | Accepted |
| [0025](0025-prune-the-install-prefix.md) | Prune the install prefix — remove what this host cannot use, decided by a pure manifest read; an install never prunes against a typed target | Accepted |
| [0026](0026-html-parsing-and-selector-engine.md) | HTML parsing stays in `@gjsify/domparser` behind leaf subpaths; one adapter-based selector engine serves both DOM models; verification is differential against parse5 | Accepted |
| [0027](0027-gtk-host-layer.md) | One GTK host layer, framework adapters on top | Accepted |
| [0028](0028-widget-table-provenance.md) | GIR-generated widget table, runtime ParamSpec for values | Accepted |
| [0029](0029-girs-widget-vocabulary.md) | The widget vocabulary ships from `@girs/*` under a `surface` subpath, with no JSX namespace | Accepted |
| [0030](0030-one-corpus-gjs-as-oracle.md) | One test corpus per claim, parameterised by runtime; GJS is the oracle | Accepted |
| [0031](0031-node-gi-napi-outside-the-workspace.md) | `node-gi` and `napi` stay outside the npm workspace | Accepted |
| [0032](0032-react-native-on-the-gtk-host.md) | A React Native view layer over the GTK host, split so every binding can use the shared half | Proposed |
| [0033](0033-declarative-templates-preferred.md) | A widget tree is declared in a template file; TypeScript holds the behaviour | Proposed |
| [0034](0034-widget-vocabulary-convergence.md) | Every widget surface: named from the GIR, exported as a namespace, remainder declared | Proposed |
| [0035](0035-web-view-on-win32.md) | A web view on Windows: WebView2 behind the same `gi://WebKit` 6.0 namespace | Proposed |
| [0036](0036-third-party-react-native-surfaces.md) | Third-party React Native surfaces: one registry, one package, one subpath each | Proposed |
| [0037](0037-react-native-prop-surface.md) | The React Native PROP surface is published as a subpath; a refused prop keeps throwing | Proposed |

Source review: [docs/reports/2026-07-01-architecture-review.md](../reports/2026-07-01-architecture-review.md)
(condensed findings + prioritized backlog).
