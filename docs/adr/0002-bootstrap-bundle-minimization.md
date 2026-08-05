# ADR 0002 — Minimize committed bootstrap bundles

- **Status:** Accepted (2026-07-01), **amended 2026-08-02** — see [Amendment](#amendment-2026-08-02--the-previous-release-supplies-the-toolchain-never-the-installer). The direction stands; decision 2 is corrected (the full CLI arrives from a separately pinned prefix, not from the workspace lockfile) and decision 3's deletion list shrinks by two artifacts.
- **Scope:** `packages/infra/cli/dist/*.gjs.mjs`, `packages/infra/tsc/dist/tsc.gjs.mjs` + `lib/lib*.d.ts`, `.githooks/pre-commit`

## Context

The repo commits ~10 MB of generated artifacts: `cli.gjs.mjs` (~6.5 MB),
`affected.gjs.mjs`, `tsc.gjs.mjs` (~3.6 MB) and ~108 TypeScript default-lib files
(~76k lines). They exist for one reason — bootstrap: a fresh clone must be able to
run `gjsify install` with no Node/npm present (the Node-free chain's entry point).

The cost is recurring and structural:

- **Bundle staleness is the #1 failure source in parallel PR pipelines** — despite
  the pre-commit rebuild hook and the CI version check, a bypassed hook lands red CI
  (~90 min wasted per PR × 2 platforms; the hook + check are guards *around* the
  problem, not a fix).
- Every CLI/tsc source change carries a multi-MB binary-ish diff; git history and
  clone size grow permanently.
- Two real incidents came from artifact-in-git lifecycle bugs (v0.4.37–0.7.2 empty
  `lib/` packer glob; v0.7.2 `pickLibSource` clobber).

Only a small slice of the committed CLI is actually needed *before* the first
install: `install` (native backend), `run` (to execute gjs), and the version/
integrity plumbing. Everything else (build, bundler, storybook, flatpak, devtools,
publish, …) is only reachable *after* node_modules exists — at which point the CLI
can come from the registry like any other package.

## Decision

1. **Commit only a minimal bootstrap bundle** (`bootstrap.gjs.mjs`): `install`
   (native backend + lockfile + tarball cache), `run`, `--version`/integrity check.
   Target: single-digit-hundreds of kB, changes rarely.
2. **The full CLI and `@gjsify/tsc` are consumed from the registry** — pinned by the
   workspace's own `gjsify-lock.json` like every other dep, laid down by the
   bootstrap install into `node_modules/.bin/`. The committed full bundles are
   removed from git once the bootstrap path is validated.
3. **The pre-commit hook shrinks** to rebuilding only the bootstrap bundle (rare) —
   the staleness failure class is eliminated for the day-to-day CLI/tsc work, not
   guarded against.
4. **Offline/air-gapped installs** keep working through the existing mechanisms:
   the SRI-keyed tarball cache, `gjsify generate-installer`, and the Flatpak
   `gjsify-sources.json` path — none of which require artifacts in git.
5. `affected.gjs.mjs` (the Soup-free CI classifier) follows the same route once the
   classifier host installs from the registry; until then it may stay committed —
   it is small and owned by CI, not by contributors.

## Consequences

- CLI/tsc PRs become source-only diffs; the hook/CI-check machinery around bundle
  freshness shrinks to the bootstrap file.
- The first `gjsify install` on a fresh clone now downloads the full CLI — bounded
  by the existing tarball cache (CI already caches it keyed on the lockfile).
- Release ordering matters: the bootstrap must be able to install the *current*
  workspace CLI version → the lockfile pins it, same as today's self-hosting.
- Migration risk is contained by keeping the committed full bundles until the
  bootstrap-install e2e (fresh-clone fixture, no Node, no node_modules) is green on
  both Fedora legs.

## Implementation

1. Carve `bootstrap` entry out of the CLI (reuse the `affected.gjs.mjs` precedent —
   a dedicated small-import entry + `build:bootstrap-bundle`).
2. `tests/e2e/bootstrap-install/`: fresh-clone fixture → `gjs -m bootstrap.gjs.mjs
   install --immutable` → full CLI available → `gjsify build` a sample.
3. Flip the workspace scripts to the installed CLI; remove `dist/cli.gjs.mjs` +
   `dist/tsc.gjs.mjs` + committed `lib/lib*.d.ts` from git; shrink hook + CI check.
4. Keep `gjsify self-update` / global-install paths pointed at the registry
   artifacts (already the case).

## Amendment (2026-08-02) — the previous release supplies the TOOLCHAIN, never the INSTALLER

The direction stands and every measurement in the Context above got worse, not
better: `cli.gjs.mjs` is now **250 commits** on `main`'s history (373 across all
refs) at 6,605,536 B, and the three bundles together are ~135 MiB of an 883 MiB
packed object store — roughly **15 % of the repository's entire history, from
three generated files**. Since this ADR was accepted, `main` shipped a
non-reproducing bundle twice (`status/open-todos.md`), and the failure lands on
whoever pushes next rather than on whoever caused it.

What changes is **decision 2**, and the correction is not a detail — the obvious
reading of it bricks the repo on a delay fuse.

### Decision 2 as written is unimplementable

It says the full CLI and `@gjsify/tsc` are "pinned by the workspace's own
`gjsify-lock.json` like every other dep". They cannot be: `grep -c '"@gjsify/'
gjsify-lock.json` → **0**. `install.ts` symlinks any workspace-named dependency
regardless of the spec it carries, so a workspace member can never appear in the
workspace's own lockfile. The pin needs its own prefix.

### The wedge: the installer must be SAME-COMMIT

The tempting simplification — drop every committed bundle and let the previous
release's `gjsify` do the install — is the one shape that cannot work, because
the installer reads a file whose FORMAT this repo evolves:

| | `LOCKFILE_VERSION` | on an unknown version |
|---|---|---|
| `v0.26.1` (last release) | `2` | `if (parsed.lockfileVersion !== LOCKFILE_VERSION) return null;` |
| `main` | `4` | `READABLE_LOCKFILE_VERSIONS = new Set([2, 3, LOCKFILE_VERSION])` |

**This has now fired, on purpose.** The tracked `gjsify-lock.json` was
`"lockfileVersion": 2` when this ADR was written, which is why the paragraph
below was future tense. It is v4 as of the platform-filter migration: a v2 entry
carries no `os`/`cpu`/`optional`, so the platform filter had nothing to filter on
and every checkout installed every platform's prebuilds (measured: 4935 MB → 1268
MB, 183 foreign-platform packages → 0). The format had to move for the data to
exist at all.

So a v0.26.1 installer now reports `--immutable requires gjsify-lock.json … none
found` for a file that plainly exists. Backwards compatibility was added in the
right direction (new CLI reads old lockfiles); a previous-release installer needs
the other direction, which no amount of care can retrofit into an
already-published artifact.

What keeps that from killing the fresh clone, the container jobs (`gjsify-setup`
boots the bundle before anything is installed), `release.yml` and
`release-cut.yml` is precisely this ADR's rule, already in force: **all nine
`install` invocations in CI run `gjs -m packages/infra/cli/dist/cli.gjs.mjs
install --immutable`** — the same-commit bundle, whose reader set includes its
own version. Nothing in this repo installs with a *published* gjsify. The wedge
is no longer a hypothetical to design around; it is a live constraint that the
same-commit rule absorbs, and the cost of ever revisiting "let the previous
release do the install" is now immediate rather than deferred.

**So a minimal, version-free `bootstrap/bootstrap.gjs.mjs`, built from the SAME
commit, stays tracked** — `install` + `run` + integrity, measured at ~500 KB
against 6,605,536 B. Same-commit is what makes it immune to both the
lockfile-format wedge and a broken predecessor. The previous release supplies the
full CLI, `@gjsify/tsc` and the bundler engine from a pinned
`.gjsify/toolchain/` prefix (its own `package.json` + `gjsify-lock.json`,
`node_modules/` gitignored), naming the optional peers explicitly — they are
`peerDependenciesMeta` optional and the native install backend does not resolve
peers at all.

### Per-artifact decisions (decision 3's deletion list shrinks)

| Artifact | Size | Commits | Decision |
|---|---|---|---|
| `cli/dist/cli.gjs.mjs` | 6,605,536 B | 250 | **untrack** — stays a build output at the same path, an npm-tarball entry and a release asset |
| **new** `bootstrap/bootstrap.gjs.mjs` | ~500 KB | — | **track**, version-free, same-commit, with a hard build-time size ceiling |
| `cli/dist/affected.gjs.mjs` | 248,583 B | 37 | **keep tracked** (§5 already allowed this) |
| `tsc/dist/tsc.gjs.mjs` | 3,584,109 B | 26 | **untrack** |
| `tsc/lib/lib*.d.ts` | 108 files | **1** | **keep tracked** — reverses implementation step 3 |

Two keeps, each for a reason that is not "it is inconvenient":

- **`affected.gjs.mjs`** is booted by the CI `changes` job on plain
  `ubuntu-latest` with `apt-get install -y gjs`, before any install, and it
  gates the whole selective-CI system `continue-on-error`. It also has **no
  distribution channel at all** — absent from `@gjsify/cli`'s `files` and from
  `release.yml`'s asset list — so "fetch it instead" is not yet a thing that
  exists. Converting the classifier to a plain Node script would delete this
  artifact outright, but it forks the `IGNORE`/`GLOBAL_TRIGGERS`/
  `SCRIPT_COUPLINGS` tables away from the user-facing `gjsify affected`; a second
  copy is a second truth, and a fail-open gate hides its drift. Deferred as its
  own track.
- **`tsc/lib/lib*.d.ts`** have **one commit in the repo's history**. There is no
  churn to save, and removing them reopens the v0.4.37–0.7.2 `TS6053` +
  `TS2318` cascade that `pickLibSource()` holds shut. The exception is stated so
  it cannot be stretched: *churn ≈ 0 **and** regeneration requires an exact
  pinned third-party version.* They are a vendored dependency that happens to be
  generated, not a build output.

### Version-free is load-bearing, not tidiness

**43 of the 250** commits on `cli.gjs.mjs` are `chore: release` — the bundle
bakes its own version (2 occurrences), so cutting a release rewrites 6.6 MB to
move a string. `affected.gjs.mjs` bakes it 0 times and has 0 release commits
among its 37. A version-free bootstrap deletes that entire sub-class; a
version-bearing one would keep ~17 % of the churn and re-arm the conflict on
every release.

### The pin must be checked, and staleness must be visible without a build

Three checks, each catching what the others structurally cannot: (a) the
existing `setup` job hard-errors on a pin AHEAD of the newest published release
and warns immediately when STALE (hard error beyond three releases) — in `setup`,
never a new job, because the CI gate machine-derives its own job list; (b)
`tests/e2e/bootstrap-pin/` against a throwaway fixture served by the existing
in-process registry, not the monorepo; (c) `release-cut.yml` refreshes the pin as
its FIRST step, which makes every release a continuous proof that release N−1 can
still install and build `main` — if it cannot, the cut fails before a commit, tag
or release record exists.

Separately, `build:bootstrap-bundle` emits a derived sidecar
`bootstrap/bootstrap.inputs.json` (the module ids the bundle actually inlined,
with content hashes, straight out of the bundler's module graph) and
`scripts/verify-bootstrap-inputs.mjs` recomputes it from the working tree in
seconds, build-free. This replaces `.githooks/pre-commit`'s four-path trigger
heuristic — whose own limitation AGENTS.md states outright ("ANY source the
bundle inlines stales it, not just the hook's four paths") — with something
exhaustive by construction, and it keeps the class visible on every PR instead
of only inside a ~20-minute rebuild.

### Do not

- **Do not make the installer come from a published release.** The lockfile
  table above is the whole reason a minimal bundle stays in git; "the installer
  is tiny and rarely changes" is exactly the argument that makes the wedge
  invisible until it detonates.
- **Do not put the toolchain pin in `gjsify-lock.json`.** It cannot hold a
  workspace name (0 entries, measured).
- **Do not delete `tsc/lib/lib*.d.ts`** on the grounds that they are generated.
- **Do not drop the byte-reproducibility oracle** when the bundles leave git.
  It moves to `release-cut.yml` (once per release, on the host where determinism
  is measured) rather than disappearing — with `prebuilds/**` unguarded, it is
  the only reproducibility oracle the repo has left.
