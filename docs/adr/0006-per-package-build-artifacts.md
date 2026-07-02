# ADR 0006 — Per-package build cache; publish-time-only lib builds (spike)

- **Status:** Accepted (2026-07-01) — phase 2 is a spike with an explicit decision point
- **Scope:** CI `main.yml` build step, `gjsify build`/`workspace`/`foreach`, package `lib/` outputs

## Context

The full-matrix CI build takes ~27 minutes because Rolldown re-bundles every
package's `lib/` on every run — the last big cost block after the 2025/26 CI-speedup
work (image reuse, node_modules cache, selective tests, job split, e2e sharding cut
the rest from ~74 min to ~36 min). The deeper architectural question: workspace
consumers already resolve `workspace:^` siblings from source at *app* build time —
per-package `lib/` bundles exist for (a) publishing, (b) `.d.ts` type flow
(`check`/`build:types` needs deps' declarations first), and (c) tools that execute a
package directly. (a) is release-time-only; (b) is `tsc`, not Rolldown; only (c)
genuinely needs per-PR bundling — and only for the packages a PR touches.

## Decision

**Phase 1 (mechanical, high ROI, do now): content-hash per-package build cache.**

1. Cache key per package: hash of `src/**` + `package.json` + tsconfig + the
   *cache keys of its workspace dependencies* (transitive correctness) + toolchain
   version (CLI/tsc/Rolldown). On hit, restore `lib/` (+`dist/` where applicable);
   on miss, build and store.
2. Implemented inside `gjsify` (a `--cached` mode for `workspace`/`foreach` build
   scripts) rather than as raw CI cache globs — the v0.x incidents (cache restore
   clobbering a no-build `lib/`, keys hashing only `src/**`) showed that bundling
   cache logic into CI YAML is fragile; the CLI owns the dependency graph and can
   key correctly. CI then persists the CLI's cache directory, nothing more.
3. Local dev gets the same speedup for free (`gjsify foreach build` skips unchanged
   packages).

**Phase 2 (spike, decide with data): publish-time-only lib builds.**

4. Investigate resolving workspace-internal consumption from TS sources / typecheck
   output only, producing `lib/` bundles solely at release/publish time. Success
   criteria for adoption: `check`/`build:types` flow intact (declaration order
   preserved), app/e2e builds equal or faster, no consumer-visible change to
   published tarballs. If the spike fails the criteria, Phase 1 remains the
   long-term answer and the spike is closed with a written finding here
   (status update on this ADR).

## Consequences

- Phase 1 turns the dominant CI cost from O(all packages) to O(changed closure) —
  same shape as the affected-test classifier, applied to builds.
- Correct hashing of the toolchain version is load-bearing: a CLI/bundler bump must
  invalidate everything (the committed-bundle version string is part of the key —
  and gets simpler after ADR 0002).
- Phase 2, if adopted, also shrinks what ADR 0002 has to bootstrap and removes the
  clean-build-vs-incremental divergence class ("clean build masks CI build-order
  errors") by making the per-PR path source-based everywhere.

## Implementation

1. `gjsify` build-cache module (hash graph walk; storage under
   `node_modules/.cache/gjsify/build/` locally, a single CI cache dir remotely);
   explicit `!`-exclusions never restore over packages with no build script (the
   documented v0.x clobber gotcha).
2. Wire into `main.yml`; measure (expect build ≪ 27 min on typical PRs).
3. Phase-2 spike behind a branch: one pillar (e.g. `packages/node/*`) consumed
   source-direct; run full check/test/e2e; write the finding into this ADR.
