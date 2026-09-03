# AGENTS.md — gjsify

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning — consult `refs/` submodules and `@girs/*` types before pre-trained knowledge.

Node.js/Web/DOM API + Framework for GJS (GNOME JS). npm-workspaces monorepo, v0.46.0, ESM-only, GNOME libs. Bootstraps from the PUBLISHED gjsify (ADR 0002): `gjs -m install.mjs` → `gjsify install --immutable` → `gjsify run build:infra`. No committed bundle, no yarn, no Node-only npm CLI. `dist/{cli,tsc}.gjs.mjs` are build outputs; only `dist/affected.gjs.mjs` is tracked. Five pillars — Node.js, Web, DOM, Framework, NativeScript bridge — over supporting infra in `packages/infra/` + `packages/gjs/`; paths in the table below. Counts, status tables and metrics are DERIVED, never here (§ Governance → status).

## Where the rules live — nearest AGENTS.md wins

This file holds what is true across the whole repo. Everything scoped to one subtree lives in
THAT subtree's AGENTS.md and is authoritative there — never restate it here, a second copy is a
second truth that drifts. **Read this file, then the one for what you are touching.**

| Working on | Read |
|---|---|
| `packages/node/*` — Node API pillar, CJS-ESM interop | [packages/node](packages/node/AGENTS.md) |
| `packages/web/*` — Web API pillar | [packages/web](packages/web/AGENTS.md) |
| `packages/dom/*` — DOM pillar | [packages/dom](packages/dom/AGENTS.md) |
| `packages/framework/*` — GTK host, storybook, devtools, bridges, ADR 0012 registration | [packages/framework](packages/framework/AGENTS.md) |
| the CLI + the GJS bootstrap bundles | [packages/infra/cli](packages/infra/cli/AGENTS.md) |
| the build (`--app <target>`, platform plugins) | [packages/infra/rolldown-plugin-gjsify](packages/infra/rolldown-plugin-gjsify/AGENTS.md) |
| slot routing (`@gjsify/<X>` → platform entry) | [packages/infra/resolve-npm](packages/infra/resolve-npm/AGENTS.md) |
| `packages/node-gi` — axis 5, `gi://` on Node/Bun/Deno | [packages/node-gi](packages/node-gi/AGENTS.md) |
| `packages/napi` — N-API host in GJS | [packages/napi](packages/napi/AGENTS.md) |
| `packages/nativescript-bridge` | [packages/nativescript-bridge](packages/nativescript-bridge/AGENTS.md) |
| writing or running tests | [tests/](tests/AGENTS.md) |

Reference material — read on demand, not loaded every session:

| | |
|---|---|
| the long-form governance reasoning | [docs/governance.md](docs/governance.md) |
| OS-axis enforcement + portability strategy | [docs/runtime-platform-axes.md](docs/runtime-platform-axes.md) |
| the measured anti-patterns, with their incidents | [docs/code-anti-patterns.md](docs/code-anti-patterns.md) |
| `/register` subpath convention | [docs/register-convention.md](docs/register-convention.md) |
| build artifacts: the git hook, freshness, what an exit code proves | [docs/build-artifacts.md](docs/build-artifacts.md) |
| native extensions + prebuilds | [docs/prebuilds.md](docs/prebuilds.md) |
| first-publish bootstrap + release closure | [docs/publishing.md](docs/publishing.md) |
| selective CI | [docs/ci-selective.md](docs/ci-selective.md) · lint/format [docs/lint-format.md](docs/lint-format.md) |
| GNOME lib ↔ API mapping table | [docs/gnome-mappings.md](docs/gnome-mappings.md) |
| `refs/` · attribution · status data · examples · axis 6 | [references](docs/references.md) · [attribution](docs/attribution.md) · [status](docs/status-changelog.md) · [examples](docs/examples-showcases.md) · [toolchains](docs/bundled-toolchains.md) |

ADRs: `docs/adr/` (numbered, MADR-style). Open work: `status/open-todos.md`.

## Governance — non-negotiable

Short form; the reasoning behind each is [docs/governance.md](docs/governance.md).

|doc: an architectural decision (package boundaries, API patterns, build, deps, cross-cutting) updates the AGENTS.md that OWNS that scope, in the same PR — never leave drift between sessions
|adr: decisions spanning pillars/repos, changing a published contract, or scoping a whole track get an ADR under `docs/adr/` BEFORE implementation
|tier: every published pkg declares `package.json#gjsify.tier` (1 core / 2 product / 3 experimental, ADR 0003); deps must point to same-or-lower tier; enforced by `scripts/audit-runtimes.mjs --check`
|required checks: `main` is branch-protected and exactly THREE checks block a merge — `CI gate (GJS)`, `Detect runtime-triplet drift`, `Lint commit messages`. Only workflows with NO `paths:` filter are eligible; everything path-filtered stays ADVISORY — read it before merging. Do not add a fourth without reading [docs/governance.md](docs/governance.md) first: a required check that does not RUN blocks the PR forever
|declarations: `gjsify.{runtimes,platforms,headless,prebuilds}` are per-package declarations, each MACHINE-CHECKED — model in § Runtime & platform model. No declaration without a check; no promised prebuild target without a loadable artifact behind it
|manifest-conformance: every "does this declaration match reality" check is a rule in ONE registry — `@gjsify/manifest-conformance`. `field-coverage` FAILS on any `gjsify.*` key no rule claims, so a new declaration kind cannot be added without a check
|status: the status snapshot is AUTHORED DATA in `status/`; everything derivable is rendered into a GITIGNORED `STATUS.md` by `npm run status:generate` and never committed — [docs/status-changelog.md](docs/status-changelog.md)
|simplicity: every guard was justified ALONE; the cost is the SUM. Adding a check/step/artifact — ask what it lets you DELETE, and periodically whether the whole arrangement has a simpler SHAPE. A guard watching another mechanism is the smell. Worked example + what this does NOT license: [docs/governance.md](docs/governance.md)
|polyfills: browser-compat patches belong in packages, not examples
|root-cause: fix bugs in the core package in the SAME PR that exposed them — no "known limitation" notes, no skip-guards, no TODO-for-later (workarounds ossify); examples/tests/CI exist to surface impl gaps
|scope: expanding PR scope is the *expected* cost, not a reason to defer — goal is `@gjsify/*` running arbitrary npm packages unmodified on GJS
|exceptions (narrow, documented per case): (a) non-standard Node-internal hack → wrap/skip at consumer with a comment; (b) upstream GJS/SpiderMonkey gap → `status/upstream-patch-candidates.md`; (c) cross-cutting rewrite → Plan + user confirm + split PRs, still landing a minimal root fix in the feature PR

## Structure

`packages/{node,web,dom,framework,nativescript-bridge,gjs,infra}/` (workspace members) | `packages/{node-gi,napi}/` (NOT workspace members — own CI, § Cross-runtime tracks) | `showcases/` (published, CLI deps) | `examples/` (private dev/test) | `tests/{integration,e2e,browser,dom}/` | `refs/` (read-only submodules — DO NOT modify)

## Runtime & platform model

The ONE model for "where does this code run and who checks the claim". Four orthogonal axes, each a `package.json#gjsify.*` declaration with a machine check behind it. Everything else in this file references this section. Enforcement invariants and the portability strategy: [docs/runtime-platform-axes.md](docs/runtime-platform-axes.md).

### The axes

|**Runtime axis — `gjsify.runtimes`**: quintuplet `{gjs, node, browser, nativescript, react-native}`, each slot ∈ {`polyfill`, `native`, `partial`, `none`}. Declares which JS RUNTIMES a package serves and how; says NOTHING about operating systems. NativeScript is the 4th slot (V8 on Android/iOS, metadata-driven native bridge — conceptually GJS↔GNOME with `java.io.File`/`NSFileManager` instead of `Gio.File`); optional `gjsify.nativescriptPlatforms: ['ios','android']` (default both) narrows capability WITHIN the slot — iOS/Android are deliberately NOT separate slots, because NS ships one core with internal platform branching. If a package doesn't declare `nativescript`, the drift check skips that slot (backfill is opportunistic). **`react-native` is the 5th slot and is DECLARATION-ONLY**: Metro owns a React Native app's build the way `@nativescript/vite` owns NativeScript's, so it feeds the ALIAS layer and there is deliberately no `--app react-native`. No heuristic suggests it, so DRIFT is silent on it — `--apply` writes a suggestion verbatim into every declarable package that has none, and an unmeasured guess would land there unreviewed. Two checks still hold it: `auditRuntimeShape` (every key a known runtime, every value a known slot) and the reachability pass, where a `polyfill` slot reaching GLib/Gio is FATAL as on `browser`/`nativescript`. Not to be confused with `gjsify build --dialect react-native`, which says what the SOURCE is written in, not what the PACKAGE runs on; a package can be both.
|**OS axis — TWO declarations, one per question (ADR 0018)**: `gjsify.os` = what the CODE claims (`{linux,darwin,win32}` → `supported`/`partial`/`none`, below `supported` needs a PRINTED `gjsify.osNotes.<os>` reason), demanded only of pkgs BRANCHING on the OS in shipping source — DERIVED, so no OS-conditional code = nothing to declare; `gjsify.platforms` = the `<os>-<arch>` targets a pkg with a native build system (meson/node-gyp) or a prebuild dir PROMISES a prebuild for (a pure-TS pkg is legitimately `os.win32:"supported"` with no win32 in `platforms`). ONE spelling everywhere: `${process.platform}-${process.arch}` (`linux-x64`/`linux-arm64`/`darwin-arm64`/`win32-x64`; `ppc64`/`s390x`/`riscv64` identical in every vocabulary) — it is what a running process computes about itself, so resolution needs no translation. The retired uname spelling (`linux-x86_64`) is enforced OUT on every WRITE path and tolerated READ-only (`prebuildDirCandidates` probes declared → canonical → legacy) so pre-rename tarballs still load. The two axes are blind to each other BY DESIGN, and that blindness is measured: the whole native-bridge set stayed Linux-only while the project described itself as platform-independent, because `runtimes` says nothing about OSes. Never let one axis answer the other's question.
|**Intra-GJS layering — `gjsify.headless`** (ADR 0015): a package that DOCUMENTS itself as headless declares either `true` (root entry reaches NO typelib: no `gi://`, no `@girs/*` value import, no bare `cairo`/`system`/`gettext`, no `imports.*`) or a LIST of forbidden typelib namespaces (`["Gdk","GdkPixbuf","Gsk","Gtk","Adw"]` — headless *of GTK*, Cairo/Pango still fine). `audit-runtimes --check` walks the ROOT import graph from `exports["."]` (relative imports AND `@gjsify/*` workspace edges) and fails on any forbidden reach. ROOT-ONLY IS THE POINT: a side-effect SUBPATH may legitimately reach them (`@gjsify/canvas2d-core/gdk`, imported explicitly by `dom-elements/register/canvas` + `canvas2d`) — scanning `src/**` would flag the fix itself. Why the axis exists: the runtime axis is structurally blind here — a `gi://Gdk` import is an INPUT to the drift check (it made the declaration agree BETTER), and the ADR-0014 reachability pass only visits `polyfill`/`partial` slots, which a `node:none`/`browser:native` package has none of. That blind spot is how `@gjsify/canvas2d-core` — split out of `@gjsify/canvas2d` precisely to be GTK-free — imported `gi://Gdk` (= `libgtk-4.so` in GTK4) at five call sites for its whole life. Not wanted on pure-TS contract packages: their all-`polyfill` slots already put ADR 0014 in charge.
|**Build target — `--app gjs|node|browser|nativescript`**: how a BUILD selects a runtime; the alias layer routes each `@gjsify/<X>` per its declared slots (§ Slot routing). ONE `--app node` bundle serves node, bun AND deno (Node-API is their common ABI) — `--runtime <gjs|node|bun|deno>` on `gjsify showcase|run|storybook` selects the LAUNCHER, not a different bundle (shared map `packages/infra/cli/src/utils/runtimes.ts`). NB `gjsify.example.runtimes` (which runtimes a showcase SHIPS artifacts for, § Showcase) is a distinct field from `gjsify.runtimes` (slot routing).

## Don't patch — implement at the source

We own ~every Web/Node/DOM API. First question for any new feature: *"which package owns this,
can we implement it there?"* — never *"where can we monkey-patch it in?"*. The five hard rules,
each with the incident that produced it, are [docs/code-anti-patterns.md](docs/code-anti-patterns.md):

|**reading globals**: `import { X } from '@gjsify/<pkg>'`, not `(globalThis as any).X` — six documented exceptions, all in register/bootstrap code
|**the legacy `imports.*` object is NOT an API** — it is the GJS host, absent on the node target, and a bare `imports.gi.X` is a `ReferenceError` thrown at the CALL, so the package tests green and the failure surfaces in a consumer. Portable spellings exist for every use (`gi://Ns`, `import system from 'system'`, `TextDecoder`). Enforced by `no-restricted-globals` and `node-bundle-guard.ts`
|**patching classes you own**: put the method on the class, not on `globalThis.X.method=…` in a register module
|**"no module to import from"**: check again — the workspace almost certainly exports it
|**pure-JS → native swap**: keep the pure-JS path and lift it into a `/core` subpath; the other runtimes still need it. A `/core` subpath beats a new `-core` package — a separate NAME needs a package-level cycle or independent external consumers, never onboarding cost (a release step, § Package convention)

## Code anti-patterns — measured

Recurring shapes LLM-written code gets wrong. Every one was paid for in THIS repo; the incidents
are in [docs/code-anti-patterns.md](docs/code-anti-patterns.md) — read them before arguing with a rule.

|**try/catch around a call that cannot throw** — for GI calls read the GIR, only `throws="1"` raises. A kept catch must STATE ITS REASON; `eslint/no-empty` is `error`
|**paranoid probes for what the workspace guarantees** — redundant `x?.m?.()` on our own classes hides real bugs as silent no-calls. Only the documented probes are sanctioned
|**comments that restate the code** — comment WHY; a restating comment is a second copy that drifts. Cut restatement, narrative history, upstream source coordinates; keep the incident, GI quirks, spec links, error text. A LIVE COUNT is restatement too, and drifts unseen (`224 packages` → 232, `~110` → 199): write what the number establishes, not the number. `scripts/check-comment-budget.mjs` reports per-tree volume — a score, so it advises
|**duplication instead of a helper** — the SECOND copy is where you lift; the drifted copy fails in a CONSUMER while the owning package stays green
|**scattered lifecycle** — cleanup beside creation, ownership in ONE place, wired to the exit the host actually has
|**shelling out where an API exists** — pass an argv array (`Gio.Subprocess`), never an interpolated command line
|**monolithic entry points** — `index.ts` = barrel re-exports only
|**a side-effect import that has no side effect** — css-as-string makes any CSS import `export default "<css>"`, so a bare `import './x.css'` (or of a package whose `.` export IS css) tree-shakes away, exit 0. `@gjsify/adwaita-web` shipped no font that way for its whole life, invisible on a GNOME host. Import the VALUE and apply it; enforced by `gjsify/no-css-side-effect-import`
|**an interface assembled in TypeScript** — a widget class that builds its own children instead of declaring them in a `.blp` cannot be translated AT ALL: a caption assigned from code carries no `translatable` attribute, so `xgettext` never sees it and the app looks untranslated rather than untranslatable. Measured 2026-08: Learn6502 holds a whole application in 24 Blueprint files with 8 programmatic constructions; two apps that grew the other way carry 31 template-free widget classes and 673 unreachable captions. Declare the tree in Blueprint, keep logic in TypeScript, fill data-driven children inside the template. Enforced by `gjsify/prefer-blueprint-template` + `gjsify/no-literal-widget-label`
|**toolkit imports in shared code** — declare `gjsify.headless` so CI holds the claim instead of relying on discipline
|**a deferral marker that names nothing** — a `TODO`/`FIXME`/`HACK`/`XXX` opening a comment line must anchor to `#123`, a forge issue URL, `open-todos` (the `status/` ledger) or `fixed upstream in …`; better still, fix it in the PR that exposed it. A bare marker has no owner and no retirement. Enforced at `error` by `gjsify/todo-needs-anchor`

## Package convention

`packages/<pillar>/<name>/` → `@gjsify/<name>`, ONE workspace version (release train, ADR 0008 — compatibility guaranteed only within a release), `"type":"module"` | exports `./lib/esm/index.js` (+ `./lib/esm/register.js` if globals) | `sideEffects` pinned register-only | scripts `build:gjsify|build:types|build:test:{gjs,node}|test|test:{gjs,node}` | deps `@girs/*`, devDep `@gjsify/unit`, workspace deps `workspace:^`. Layout: `src/index.ts` (pure named exports) | `src/register.ts` | `src/*.spec.ts` | `src/test.mts`. Full register rules: § Tree-shakeable globals.

Shared utils: `@gjsify/utils` — check before duplicating; extract only when a 2nd package needs it; `/core` vs barrel split in § Runtime & platform model. `@gjsify/stream` direct imports allowed in internal modules/tests needing non-standard exports; all public code uses `node:stream`.

Adding a NEW `@gjsify/*` name requires a manual npm first-publish + Trusted Publisher bootstrap
BEFORE the release that ships it — skipping it stalls the release train for every alphabetically
later package. Procedure: [docs/publishing.md](docs/publishing.md).

## Testing

`@gjsify/unit` (describe/it/expect, Node + GJS). Run: `gjsify workspace @gjsify/<pkg> run test[:node|:gjs]`;
e2e `node --test tests/e2e/<name>/run.mjs`. Full rules — the seven numbered conventions, browser
tests, integration tests — are [tests/](tests/AGENTS.md). The three that get broken most:

|**never weaken a test** to make it pass — fix the impl. When the blocker genuinely is not ours, the sanctioned tool is `it.failing(name, fn, reason[, {when}])`, never `it.skip` and never an `if (platform)` guard: it RUNS the test and fails the day it starts passing, so it retires itself
|**Node tests prove the TEST is correct; GJS tests prove OUR impl.** Both must pass
|**`/register` side-effect tests go in a dedicated `register.spec.ts`** — `/register` can pull GTK/Cairo through its import chain and crash Node

## Implementation workflow (TDD)

1 study `refs/node/lib/<name>.js` → 2 port tests (`@gjsify/unit`) → 3 `gjsify run test:node` (verify the tests) → 4 `test:gjs` (expect failures) → 5 implement with `@girs/*`, consult `refs/{deno,bun,quickjs,workerd}/` → 6 iterate until both pass → 7 full gate: `gjsify install --immutable && gjsify run clear && gjsify run build && gjsify run check && gjsify run test`.

## Commit conventions

Conventional commits `<type>[scope]: <description>`, imperative, ≤50-char subject; commitlint enforces on every PR. **All types surface in CHANGELOG.md** (`.release-it.json` `types`) — use the best fit, none is dropped: `feat` `fix` `perf` `revert` `docs` `refactor` `build` `ci` `chore` `test`; `style` hidden. Scope = lowercase package name without `@gjsify/` (`fix(rolldown-plugin-gjsify): …`), `(e2e)` for e2e suites, omit when crossing packages.

## PR size — prefer few large ones

A full CI pass is ~25 minutes, and that cost is per PR, not per commit: **land one
large feature PR rather than several small stacked ones.** The measurement (four
stacked PRs → three main-merge rounds, two bundle rebuilds before anything landed)
is in [docs/governance.md](docs/governance.md).

**Do not idle on CI.** A green run gates MERGING, not writing the next commit —
push, keep going, check back. Watch the WORKFLOW status, not the check list: a
workflow that has not spawned its jobs contributes zero checks, so "no pending
checks" reads as green before anything has started.

## Constraints

Target: GJS 1.86.0 / SpiderMonkey 140 (ES2024) / Rolldown `firefox140` | ESM-only | GNOME libs + standard JS only | tests pass on Node + GJS | do NOT modify `refs/`. SM128 (GJS 1.84) is no longer supported; SM128-era polyfills still load (idempotent no-ops), retired package by package as native SM140 paths are validated. SM140 highlights beyond ES2024: Iterator helpers, `import … with{type:"json"}`, Temporal (preview), Float16Array, `Uint8Array.{from,to}{Base64,Hex}`, `RegExp.escape`, `Promise.try`, `JSON.rawJSON`, `Intl.DurationFormat`, `Math.sumPrecise`, `Atomics.pause`, `Error.isError`, native `Error.captureStackTrace`.

**TypeScript version invariant**: root + EVERY workspace declares `typescript: "^6.0.3"` — no 5.x
carve-out, enforced by the CI `gjsify upgrade --check` step. Bumping it touches every
`package.json` incl. `templates/*` and the integration tests, in one PR. Do NOT reintroduce a 5.x
pin + root `overrides` scoping — the reasoning and the two CI breaks behind it are in
[docs/governance.md](docs/governance.md).

## Cross-runtime tracks

The active axis-5/axis-6 engineering tracks. Concepts + slot model: § Runtime & platform model. Axis 5 → [packages/node-gi](packages/node-gi/AGENTS.md) ·
N-API host → [packages/napi](packages/napi/AGENTS.md) ·
NativeScript → [packages/nativescript-bridge](packages/nativescript-bridge/AGENTS.md) ·
axis 6 bundled toolchains → [docs/bundled-toolchains.md](docs/bundled-toolchains.md).

## Writing agent context files

**Budget first — an agent context file is loaded on EVERY turn, so its size is a permanent tax.**
Every AGENTS.md ≤ 20 KB, nothing over 32 KiB: that is `project_doc_max_bytes`, where Codex
silently truncates the tail with no warning. This file reached 277 KB before it was split, one
defensible paragraph at a time. Held by `scripts/check-agent-context-size.mjs --check`: the 32 KiB
cap plus an EXACT per-file ceiling. This file and `packages/framework/AGENTS.md` are over the
20 KB target, so the gate catches REGROWTH instead of claiming the target is met. Exact means
BELOW fails too: touch a context file, `--update`, commit `status/agent-context-budget.json` with
it. Slack is what two concurrent PRs each spend in full, and that ledger line is what makes them
collide in git rather than on `main` ([docs/governance.md](docs/governance.md) § Concurrent PRs).

**Where content goes.** True repo-wide → this file. Scoped to one subtree → that subtree's
AGENTS.md, authoritative there. The INCIDENT behind a rule, a lookup table, a rare procedure →
`docs/`, linked from the rule. Growing a section past a screen is the signal to move its detail
out and leave the rule plus one link, never to append.

**Never compress away the INCIDENT that justifies a rule** — a rule without its reason gets
"simplified" back into the bug. Moving it one hop into `docs/` preserves it; deleting it does not.

Style: pipe-delimited | single-line directives | strip prose | abbreviated keys | "Prefer
retrieval-led reasoning" preamble | keep non-obvious code examples | never compress error
messages or edge-case docs.
