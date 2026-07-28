# @gjsify/manifest-conformance

Check that what a `package.json` **declares** matches what the package actually
**ships**.

A manifest is a set of promises — `exports`/`main`/`types`/`bin` promise files
exist, `gjsify.platforms` promises a prebuild per target, `gjsify.headless`
promises the root entry reaches no typelib. Every one of those promises can be
false while the build exits 0. This package holds them to their word.

## Why it exists

Five standalone scripts in this repository had grown to ~3 400 lines all asking
the same shape of question, each written in reaction to a separate incident:

| Incident | Guard that came out of it |
|---|---|
| `@gjsify/oxfmt-native` declared `darwin-arm64` for weeks with no artifact | prebuild existence |
| A macOS bridge shipped without its Rust cdylib sibling (#832) | loader-path / structural loadability |
| An emulated build ran on the runner's own architecture | machine-vs-directory |
| A stale `.tsbuildinfo` made `gjsify tsc` a silent no-op (#67) | declared outputs exist |
| `@gjsify/canvas2d-core` documented itself headless and imported `gi://Gdk` | headless contract (ADR 0015) |

The collection grew; it was never designed. Nothing connected *"we added a field
to the manifest contract"* to *"therefore something must verify it"* — so a new
declaration kind could ship with nothing checking it, and you could only find
that out by reading five scripts and noticing an absence.

## The registry

Rules register themselves and declare the manifest **fields** they govern. The
`field-coverage` rule then derives the set of `gjsify.*` keys actually declared
across the tree and **fails on any key no rule claims**. Adding a declaration
without a check is no longer something you can forget; it is a red build naming
the file to edit.

An honest escape exists and only that: an unchecked-field ledger where each
deferred key carries a mandatory written reason, printed on every run, and which
becomes a failure the moment a rule claims the key or the field stops being
declared. Same shape as `gjsify.platformsUncommitted`, for the same reason.

## Scope — the axis that decides where a rule lives

- **`portable`** (this package) — reads only the manifest, files on disk and
  binaries. Correct in any npm package: `package-outputs`,
  `prebuild-artifacts`, `headless`, `field-coverage`.
- **`repo`** (`scripts/manifest-conformance/` in the gjsify repo) — knows about
  *that* repository: its directory layout as an axis taxonomy, curated
  `@gjsify/*` package-name allowlists, `prebuilds.yml`'s matrix,
  `@gjsify/resolve-npm`'s alias table, `refs/` submodules. Correct there,
  actively misleading anywhere else.

Scope is not a quality judgement. `runtimes-drift` is the most battle-tested
check in the set and is firmly `repo`: it compares a declaration not to a fact
but to a heuristic re-derivation built out of one specific tree.

## No build step, on purpose

The implementation is plain ESM (`lib/*.mjs`) with a hand-written
`lib/index.d.ts` — the same shape as `@gjsify/resolve-npm`. That is what lets
the same rule modules be imported by a **zero-install CI script** (a relative
path into `lib/`, no `node_modules`, no compiled output) *and* by TypeScript.
`.github/workflows/audit-runtimes.yml` runs on a bare runner with no install and
no build; a build step here would break that, and a TypeScript source would
break it harder.

## Status

`private: true` today. It becomes a published package when `gjsify
manifest-check` lands — a CLI command can only depend on a published package,
and publishing a new `@gjsify/*` name requires the manual first-publish +
Trusted-Publisher bootstrap (see AGENTS.md), which does not belong in a
refactor. Everything needed for that command already lives here; the command
itself is a thin wrapper over `selectRules({ scope: 'portable' })`.
