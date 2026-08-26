# ADR 0019 — ts-for-gir as a library; the `.gir` travels with the runtime package

- **Status:** Proposed (2026-08-05)
- **Scope:** `@ts-for-gir/lib` (programmatic entry, no build step), `@gjsify/gtk-runtime-*` (`gjsify.prebuilds` + `.gir`), `@girs/*` `libraryVersion`, the six bridges' `build:gir-types` recipes

## Context

`@girs/*` types are generated ahead of time from **one** upstream version and then
loaded against whatever library the host actually has. **GIRepository cannot
notice the difference** — it matches only the API version, so a `Gtk-4.0.typelib`
from GTK 4.12 and one from 4.23 both satisfy `gi://Gtk?version=4.0`.

Measured on the maintainer workstation, 2026-08-04. Host GTK **4.22.4**,
`@girs/gtk-4.0@4.1.0` generated from **4.23.0**, and `Gtk.RestoreReason.RECOVER`
is `@since 4.24`:

| | |
|---|---|
| `gjsify tsc --noEmit` | **exit 0**, no diagnostic |
| the same line at runtime | `TypeError: Gtk.RestoreReason is undefined` |
| `gjsify system-check` | `✓ GTK4 (4.22.4)` — silent |

Two routes close it, and they are **not equivalent**:

- **(a) make `libraryVersion` honest.** Helps every consumer at once, but only
  where the GIR carries a `<package version>`. Measured over the 32 installed
  packages: **12 real, 17 degenerate, 3 absent** — `@girs/gdk-4.0` states
  `4.0.0` because GDK ships *inside* GTK and declares no version of its own, a
  string shaped exactly like a release that corresponds to none.
- **(b) ship the `.gir` next to the artifact.** Types generated from the exact
  GIR the binary was built against cannot drift at all.

Route (b) is what requires a **library**. The pipeline pieces already live in
`@ts-for-gir/lib` (`gir-module.ts`, `generators/`, `transformation/`), but the
**orchestration** lives in `@ts-for-gir/cli` (`generation-handler.ts`,
`module-loader.ts`, `config.ts`), so a consumer can only shell out to a
subprocess.

Two facts make this a small step rather than a new mechanism:

- The pattern **already exists** via subprocess. Six gjsify bridges
  (`http2-native`, `tls-native`, `sab-native`, `terminal-native`,
  `http-soup-bridge`, `lightningcss-native`) run
  `ts-for-gir generate --girDirectories=<the prebuild dir>` in `build:gir-types`.
- The **`prebuild-artifacts` invariant already mandates the `.gir`** for every
  package declaring `gjsify.prebuilds`, with this reasoning in its header.

The gap is exactly where the drift was measured: `@gjsify/gtk-runtime-*`
declares only `gjsify.runtimes` and `gjsify.tier` — **no `gjsify.prebuilds`** —
so it sits outside that invariant and carries no `.gir`. GTK is the namespace
the failure above was measured on.

## Decision

### 1. ts-for-gir stays build-step-free; gjsify bundles it

Every `@ts-for-gir/*` package exports `src/index.ts` directly (`AGENTS.md`:
*"TS runs directly, no build step"*); `@ts-for-gir/lib`'s `exports` is literally
`{".": "./src/index.ts"}`. The library entry adds no `dist/`.

Bundling is **gjsify's** job, and it already ships: ts-for-gir#426 builds the
Node CLI with `gjsify build --app node`.

**Rejected: a `dist/` build in ts-for-gir.** It would place a second copy of
every generator under a freshness gate — the exact tax ADR 0002 is currently
removing from this repo, where 43 of the 250 commits on `cli.gjs.mjs` are
`chore: release` and a version bump restales every open PR's bundle.

### 2. The `.gir` travels with the RUNTIME package, never with the type package

`@gjsify/gtk-runtime-*` declares `gjsify.prebuilds` and thereby comes under the
`prebuild-artifacts` invariant, which already requires the `.gir`.

**Rejected: shipping `.gir` inside `@girs/*`.** It duplicates the generator's
input across ~700 packages, and — decisively — a `.gir` in a type package proves
nothing about the library the host will load. That is the entire failure being
fixed. Next to the binary it is one copy, and it is provenance.

### 3. `libraryVersion` states only what the library states

ts-for-gir#436. `LibraryVersion` records whether the library itself declared
`MAJOR_VERSION`/`MINOR_VERSION`/`MICRO_VERSION`, and the package template omits
the field when it did not; `PACKAGE_DESC` stops making the claim too.
**Absence becomes a fact a consumer can act on.**

**Rejected: a consumer-side allowlist of which packages to believe.**
`@gjsify/cli` carried exactly that. A value that must be second-guessed per
package is worse than no value.

## Rejected — one `@gjsify/gtk-runtime` meta name

ADR 0017's shape is per-target packages behind an `optionalDependencies` bridge,
so **npm installs the matching target automatically**. For the GTK runtime
bundles that was implemented (#910) and reverted (#920). Measured, parent vs.
merge commit, same job, same runner image:

```
b607be808 (parent)  npm install → "added 1 package"   boxed-out PASS
da9ca4001 (merge)   npm install → "added 2 packages"  boxed-out FAIL
```

The second package is `@gjsify/gtk-runtime-darwin-arm64`, 31.5 MB. An installed
bundle satisfies **candidate 4** of `resolveGtkRuntimeBundle()`
(`require.resolve`), so the process re-execs onto the **bundle's** typelibs while
the addon's native code is linked against Homebrew GTK 4.22.4. Method lookups
then land on the wrong entries — `no method 'match' on GObject-weak-notifies`,
`no method 'get_identifier' on GIRepository` — after which the runner produced no
output for **29 minutes** and the job hit its timeout.

**The bundle must not override a GTK the addon was actually built against.** The
install edge is the forbidden part, and a meta name is precisely an install edge.

It also buys nothing on the resolution side:

- resolution already works **by name** — `resolveGtkRuntimeBundle()` probes
  `require.resolve('@gjsify/gtk-runtime-<target>')` as candidate 4;
- npm's platform filter would already select correctly — the packages declare
  `os: ["darwin"]`, `cpu: ["arm64"]`;
- `@gjsify/node-gi` declares **no `optionalDependencies` at all** today. That is
  the revert, held.

Reconsider only once the mismatch is **visible rather than a timeout**: the
bundle's `manifest.json` records its build prefix and dylib set, and the addon's
`otool -L`/`LC_RPATH` records what it linked against, so a load-time check could
refuse the combination outright. Until then the bundles stay manual installs.
Tracked in `status/open-todos.md` § "The GTK-runtime bundle precedence question
is still open".

Decision 2 is **independent** of this: declaring `gjsify.prebuilds` adds a `.gir`
to the tarball, not a dependency edge.

### 4. The boundary Decision 1 implies is now enforced, not trusted

Added 2026-08-26, while auditing what else could move to ts-for-gir. Decision 1 keeps
every `@ts-for-gir/*` and `@gi.ts/*` package build-step-free, and the registry confirms
it: `@ts-for-gir/lib`, `@ts-for-gir/cli` and `@gi.ts/parser` all resolve
`exports["."]` to `./src/index.ts`. So a **`dependencies` edge from a published
`@gjsify/*` package onto one of them publishes raw TypeScript to everyone who installs
the depending package.** The sanctioned seam is a `devDependency` that gjsify bundles,
which is what all eight existing edges in this repo already are.

Nothing enforced that. `scripts/manifest-conformance/rules/tier.mjs` collects only
`dep.startsWith('@gjsify/')`, so an external `@ts-for-gir/*` edge was invisible to it,
and no other conformance rule inspects external dependency names — a package could
have taken that edge and passed `audit-runtimes --check` silently. The `tier` rule now
also fails on it, by name, the same shape it already used for ADR 0005's node-gi
isolation and for the same reason: these are external packages with no `gjsify.tier`,
so the tier walk structurally cannot see them.

**This does not restrict where GIR-derived DATA may flow.** `@girs/*` packages ship
`.d.ts` plus runtime `.js` and are unaffected — which is why ADR 0029's migration of the
widget vocabulary into `@gjsify/gtk-host` costs no new dependency edge at all: the
surface arrives as generated types on a package gtk-host already depends on.

### 5. What the boundary answers about migrating more code here

The audit behind Decision 4 sorted every introspection-carrying module in gjsify on one
question, recorded in `status/open-todos.md` § "What else could move to ts-for-gir":
**ts-for-gir knows GIR as XML** — parsed headlessly, in CI, with no GTK installed and no
typelib loaded — while **gjsify knows GI as a loaded runtime**. A module that needs an
installed library cannot move to a generator that runs without one, so the whole
typelib-loading cluster (`systemGiLibraryDirs()` and its two mirrors, `gi-typelib.ts`,
the typelib binary-header parser, both `parseGiSpecifier` copies, `repo.cc`) stays,
and ADR 0029's already-decided generator move is the only real candidate. The three
`systemGiLibraryDirs()` copies are held apart by ADR 0005's tier rule rather than by a
technical obstacle, and their home is a shared `@gjsify/*` package: answering "can it
move to ts-for-gir" with yes would export a runtime concern into a generator to dodge a
tier rule.

## Consequences

- `@ts-for-gir/lib` gains a public programmatic surface, so it acquires a
  compatibility contract it does not have today — the orchestration is currently
  free to change because only the CLI calls it.
- A library consumer must be able to run TypeScript. gjsify can; an arbitrary
  npm consumer cannot. That is deliberate — the consumer **is** gjsify.
- The six bridges' subprocess recipes may stay as they are. Nothing forces a
  migration; the library path is what enables the gtk-runtime case, which has no
  CLI equivalent because those bundles ship no `.gir` at all.
- The GTK bundles grow by their `.gir` set. Size is not a counter-argument here:
  the darwin bundle is already 31.5 MB of relocated dylibs.
- `@girs/*` consumers will see **fewer** `libraryVersion` values, not more. That
  is the intended direction — 17 of 32 currently state something untrue.

## Implementation

1. **ts-for-gir#437 → #435 → #436.** The order is forced, not preference:
   #436's own description names #435 as its prerequisite (`build:types` runs
   through `bin/ts-for-gir-dev`, which discarded its child's exit code, so the
   step that generates ~700 `@girs/*` packages could not fail), and both are red
   on `check` until #437's CLI bump lands.
2. Lift the generation orchestration from `@ts-for-gir/cli` into
   `@ts-for-gir/lib`; the CLI becomes an argv adapter over it. **No new npm name
   is required** — `@ts-for-gir/lib` exists and is published, which avoids the
   manual first-publish + Trusted Publisher bootstrap.
3. Add `gjsify.prebuilds` + the `.gir` set to `@gjsify/gtk-runtime-*`, and let
   `prebuild-artifacts` hold the claim.
4. Generate the GTK `@girs/*` from the bundle's own `.gir` on the platforms where
   a bundle is what actually runs.

## Do not

- **Do not make a GTK runtime bundle an install-time dependency, under any
  name.** See Rejected — the cost was measured at 29 minutes of silence on the
  macOS leg, and the mechanism is unchanged.
- **Do not ship a `.gir` inside a `@girs/*` package to "fix" the drift.** A
  `.gir` with no binary beside it carries no provenance, which is the whole
  property being bought.
- **Do not reintroduce a padded `libraryVersion`.** A namespace version widened
  to three components is indistinguishable from a release by inspection, which
  is what forced a per-package allowlist onto the consumer.
