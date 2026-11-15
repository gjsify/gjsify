# 145. `latest` publishes intra-repo pins exactly, like `next`

- Status: **Accepted** (2026-11-15)
- Date: 2026-11-15
- Deciders: Pascal Garber
- Amends: [ADR 0008](0008-release-versioning-policy.md) decision 2, for the published form only.
  The committed specs stay `workspace:^`.
- Depends on: [ADR 0111](0111-next-prerelease-channel.md) decision 4 (the spec rewrite this reuses)

## Context

ADR 0008 decision 2 publishes every intra-repo edge as a caret of the train version:
`@gjsify/cli@0.64.40` declares `@gjsify/net@^0.64.40`. A stable release publishes ~250 packages
in one serial, topologically ordered sweep that takes a while. During that window a caret is a
hazard for every consumer that installs a pinned *older* version:

- 2026-11-14, v0.64.41 sweep in flight. JumpLink/beifahrer's CI ran
  `npm install -g @gjsify/cli@0.64.40`. npm resolved `^0.64.40` to `0.64.41` for
  `@gjsify/async_hooks` (macOS job) and `@gjsify/net` (Linux job). The packument already listed
  `0.64.41`, the tarball still answered 404. Two jobs went red, on a pull request and on `main`,
  for a change that touched only screenshots. Both passed on rerun once the sweep finished.

The consumer did everything ADR 0008 asks: it pinned one train version. The caret silently
widened that pin to a train that did not exist yet.

ADR 0111 already removed the caret for `next`, for a related reason (a caret on a prerelease
admits the stable release beside it). `scripts/next-channel-version.mjs` rewrites
`workspace:^|~` to `workspace:*` in the CI checkout, and `gjsify pack` turns `workspace:*` into the
exact version.

## Decision

1. **The `latest` sweep runs the same spec rewrite.** `release.yml`'s `publish` job runs
   `node scripts/next-channel-version.mjs --write --pins-only` after `gjsify install --immutable`
   and before the build, gated exactly like the publish step. `--pins-only` rewrites the specs
   and nothing else: versions and `gitHead` stay as committed, and it refuses `--build`,
   `--source-sha` and `--github-output`. The script re-reads the tree afterwards and fails if a
   `workspace:^|~` survived.
2. **Nothing is committed.** `main` keeps `workspace:^`, so `release-it`, the bumper chain in
   `release-cut.yml` and every local workflow are unchanged. `audit-runtimes.yml` already runs
   `next-channel-version.mjs --check` on every pull request, so a tree the rewrite cannot handle
   fails there, not during a release.
3. **ADR 0008's contract is unchanged, and now enforced by the registry.** Compatibility is still
   guaranteed only within one release version; exact pins make an installed version's closure
   the one published with it.

## Rejected

- **Publish under a staging dist-tag and move `latest` at the end.** `npm dist-tag add` needs a
  token; Trusted Publishing (OIDC) only authorises `publish`, and a long-lived token in CI is
  what moving to Trusted Publishing removed. It also would not help a consumer that pins a
  version, which is exactly the failing case: `@gjsify/cli@0.64.40` never reads `latest`.
- **Pin only `@gjsify/cli`'s dependencies.** The same widening happens for any package a
  consumer pins; a per-package exception is a second rule that drifts from the first.

## Consequences

- A consumer that installs a pinned version is no longer affected by a sweep in flight.
- A consumer that installs the **new** version during the sweep can still meet a sibling whose
  tarball is not served yet. The topological order and `verify-published-closure.mjs` already
  cover that, and a rerun after the sweep resolves it; this ADR does not change it.
- Mixing train versions now installs both copies instead of deduplicating to the newer one.
  ADR 0008 never supported mixing; `gjsify upgrade --align` remains the repair.
- `verify-published-closure.mjs` already accepts exact pins (it checks `next` closures).
- An `only=` recovery run republishes a subset at the SAME version, so its exact pins name
  siblings the original sweep published. A subset at a new version stays impossible, as before.
