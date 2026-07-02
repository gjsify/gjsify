# ADR 0001 — `gjsify install` is non-destructive: install/clean separation

- **Status:** Accepted (2026-07-01)
- **Scope:** `@gjsify/cli` (`install`, native backend), workspace workflow

## Context

`gjsify install` is the strategic differentiator for the end-user story (Node-free
installation of GJS apps). As the monorepo's own day-to-day package manager it has
also been the single largest source of self-inflicted incidents:

- Historically an install could wipe every workspace `lib/` and the committed CLI/tsc
  bundles (the `clear` coupling; recovery required `build:infra` + `git checkout`).
- A resolver regression once deleted workspace source trees; a point guard now exists
  (`install-backend-native.ts` — "a regression in the resolver can never again
  `rmSync` a working-tree").
- Broad lockfile re-resolution on a dep change caused ~800-line churn; fixed by
  lockfile-first resolution (`buildPreferredVersions`, see AGENTS.md "Lockfile
  preservation").
- 5+ concurrent installs can hang at 0 % CPU (shared tarball store / global state,
  no cross-process locking).
- Transitive version-range conflicts resolve first-match-wins
  (`commands/install.ts:19`, documented Phase D.8 TODO).

The individual fixes exist, but the *invariant* they defend was never stated as
policy — each new install feature re-decides it implicitly.

## Decision

1. **Invariant (policy, enforced):** `gjsify install` mutates ONLY `node_modules/`,
   `gjsify-lock.json`, the XDG cache/global prefix, and (on `install <pkg>`)
   `package.json`. It never deletes or overwrites build artifacts (`lib/`, `dist/`),
   committed bundles, or any git-tracked file outside the lockfile/manifest set.
   Cleaning is an explicit, separate command (`gjsify run clear` / a future
   `gjsify clean`) — never an install side effect.
2. **Enforcement, not convention:** an e2e suite runs `gjsify install` (project,
   add-package, `--immutable`, workspace modes) inside a dirty workspace fixture and
   asserts `git status --porcelain` is unchanged for tracked files afterwards. Every
   future install feature inherits the guard.
3. **Close the remaining correctness gaps** behind the same invariant:
   cross-process file lock for the shared tarball store and global prefix (fixes the
   concurrent-install hang); a real per-workspace dedup pass for conflicting
   transitive ranges (Phase D.8) or, until then, a loud warning naming the conflict
   and the first-match pick.
4. **Dogfooding stays** — the monorepo keeps using the native backend precisely so
   these guarantees are exercised daily, but the `--backend=npm` escape hatch remains
   supported for lifecycle-script/PnP edge cases.

## Consequences

- Install bugs degrade to "wrong node_modules", never to "lost work" — the failure
  class that has cost the most recovery time disappears structurally.
- The e2e guard adds one suite to the parallel e2e batch (isolated tmp fixture,
  parallel-safe per the e2e conventions).
- The dedup pass is real resolver work (registry metadata already cached); until it
  lands, the warning makes the current behavior honest instead of silent.

## Implementation

1. `tests/e2e/install-non-destructive/` — dirty-fixture guard (fast, lands first).
2. File-lock (`flock`-style via `Gio.File` create-exclusive + stale-lock timeout) around
   tarball-store writes + global-prefix mutation; e2e with N parallel installs.
3. Conflict warning in the BFS resolver (cheap); Phase D.8 dedup pass as its own PR.
4. AGENTS.md install section gains the invariant sentence (same PR as step 1).
