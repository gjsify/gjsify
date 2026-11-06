# AGENTS.md — gjsify

IMPORTANT: Prefer retrieval-led reasoning over pre-training-led reasoning — consult `refs/` submodules and `@girs/*` types before pre-trained knowledge.

Node.js/Web/DOM API + Framework for GJS. npm-workspaces monorepo, ESM-only, GNOME libs. Bootstrap: `gjs -m install.mjs` → `gjsify install --immutable` → `gjsify run build:infra`. `dist/affected.gjs.mjs` is tracked. Five pillars over `packages/infra/` + `packages/gjs/`. Reference docs: [docs/README.md](docs/README.md).

## Where the rules live — nearest AGENTS.md wins

This file holds what is true across the whole repo. Read this, then the one for what you are touching.

|`packages/node/*` — Node API pillar, CJS-ESM interop → packages/node/AGENTS.md
|`packages/web/*` — Web API pillar → packages/web/AGENTS.md
|`packages/dom/*` — DOM pillar → packages/dom/AGENTS.md
|`packages/framework/*` — GTK host, storybook, devtools, bridges, ADR 0012 registration → packages/framework/AGENTS.md
|the CLI + the GJS bootstrap bundles → packages/infra/cli/AGENTS.md
|the build (`--app <target>`, platform plugins) → packages/infra/rolldown-plugin-gjsify/AGENTS.md
|slot routing (`@gjsify/<X>` → platform entry) → packages/infra/resolve-npm/AGENTS.md
|`packages/node-gi` — axis 5, `gi://` on Node/Bun/Deno → packages/node-gi/AGENTS.md
|`packages/napi` — N-API host in GJS → packages/napi/AGENTS.md
|`packages/nativescript-bridge` → packages/nativescript-bridge/AGENTS.md
|writing or running tests → tests/AGENTS.md

## Hard rules

Short form; reasoning in [docs/governance.md](docs/governance.md).

|doc: update the AGENTS.md that OWNS the scope, same PR — no drift
|adr: cross-pillar / published-contract / track-scoping decisions get an ADR before implementation
|tier: every published pkg declares `package.json#gjsify.tier`; deps same-or-lower; enforced by `scripts/audit-runtimes.mjs --check`
|required checks: `main` is protected by exactly THREE — `CI gate (GJS)`, `Detect runtime-triplet drift`, `Lint commit messages`. Read [docs/governance.md](docs/governance.md) before adding a fourth
|declarations: `gjsify.{runtimes,platforms,headless,prebuilds}` are machine-checked per-package declarations
|manifest-conformance: every declaration-check is a rule in `@gjsify/manifest-conformance`; `field-coverage` fails on unclaimed `gjsify.*` keys
|status: authored data in `status/`; derivables render to gitignored `STATUS.md` via `npm run status:generate`
|simplicity: every guard must justify itself; ask what it lets you DELETE
|polyfills: browser-compat patches belong in packages, not examples
|root-cause: fix core bugs in the same PR that exposes them — no "known limitation" notes or skip-guards
|scope: expanding PR scope is the expected cost, not a reason to defer
|exceptions: (a) non-standard Node-internal hack → wrap/skip at consumer with comment; (b) upstream GJS/SM gap → `status/upstream-patch-candidates.md`; (c) cross-cutting rewrite → Plan + split PRs, still land minimal root fix

## Structure

`packages/{node,web,dom,framework,nativescript-bridge,gjs,infra}/` | `packages/{node-gi,napi}/` (own CI) | `showcases/` | `examples/` | `tests/{integration,e2e,browser,dom}/` | `refs/` (read-only — DO NOT modify)

## Runtime & platform model

Four orthogonal `package.json#gjsify.*` declarations, each machine-checked. Full model + incidents: [docs/runtime-platform-axes.md](docs/runtime-platform-axes.md).

|runtime axis — `gjsify.runtimes`: quintuplet `{gjs,node,browser,nativescript,react-native}` ∈ {`polyfill`,`native`,`partial`,`none`}. `react-native` is declaration-only
|OS axis — `gjsify.os` + `gjsify.osNotes` (what source claims) and `gjsify.platforms` (prebuild targets). Blind to each other by design
|intra-GJS layering — `gjsify.headless`: `true` or forbidden typelib list; root import graph checked
|build target — `--app gjs|node|browser|nativescript`; alias layer routes per declared slots

## Don't patch — implement at the source

Rules + incidents: [docs/code-anti-patterns.md](docs/code-anti-patterns.md).

|read globals via `import { X } from '@gjsify/<pkg>'`, not `(globalThis as any).X`
|`imports.*` is the GJS host, NOT an API — portable spellings exist
|patch classes you own by adding methods, not `globalThis.X.method=…`
|"no module to import from" — check again; the workspace exports it
|pure-JS → native swap: keep pure-JS path in `/core` subpath

## Code anti-patterns

Rules + incidents: [docs/code-anti-patterns.md](docs/code-anti-patterns.md).

|no try/catch around calls that cannot throw; a kept catch states its reason
|no paranoid probes for what the workspace guarantees
|no comments that restate the code
|no duplication instead of a helper
|no scattered lifecycle
|no shelling out where an API exists
|no monolithic entry points
|no side-effect CSS imports
|no interfaces assembled in TypeScript
|declare `gjsify.headless` for shared code
|anchor every TODO/FIXME/HACK/XXX

## Package convention

See [docs/package-convention.md](docs/package-convention.md).

## Testing

Run: `gjsify workspace @gjsify/<pkg> run test[:node|:gjs]`; e2e `node --test tests/e2e/<name>/run.mjs`. Full rules: [tests/AGENTS.md](tests/AGENTS.md).

|never weaken a test to make it pass — use `it.failing(name, fn, reason[, {when}])`, never `it.skip`
|Node tests prove the test is correct; GJS tests prove the impl
|`/register` side-effect tests go in a dedicated `register.spec.ts`

## Workflow

TDD: [docs/implementation-workflow.md](docs/implementation-workflow.md). Commits: [docs/commit-conventions.md](docs/commit-conventions.md). PRs: [docs/pr-workflow.md](docs/pr-workflow.md).

## Constraints

GJS 1.86 / SpiderMonkey 140 (ES2024) / Rolldown `firefox140` | ESM-only | GNOME libs + standard JS only | tests on Node + GJS | do NOT modify `refs/`. Details: [docs/constraints.md](docs/constraints.md).

## Cross-runtime tracks

Axis 5/6 tracks: [packages/node-gi/AGENTS.md](packages/node-gi/AGENTS.md) · [packages/napi/AGENTS.md](packages/napi/AGENTS.md) · [packages/nativescript-bridge/AGENTS.md](packages/nativescript-bridge/AGENTS.md) · [docs/bundled-toolchains.md](docs/bundled-toolchains.md).

## Agent context files

Loaded every turn, so size is a permanent tax. Keep every AGENTS.md ≤ 20 KB (hard cap 32 KiB); held by `scripts/check-agent-context-size.mjs --check`. Why base-relative growth replaced a ledger: [docs/governance.md](docs/governance.md) § Agent context budget.
