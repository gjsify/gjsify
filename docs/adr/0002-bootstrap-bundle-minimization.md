# ADR 0002 — Minimize committed bootstrap bundles

- **Status:** Accepted (2026-07-01)
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
