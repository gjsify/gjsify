# ADR 0008 — Release-train versioning policy for `@gjsify/*`

- **Status:** Accepted (2026-07-01)
- **Scope:** all published `@gjsify/*` packages; consumer guidance; relation to `@girs/*`

## Context

De facto, all `@gjsify/*` packages ship as one coherent release (release-it, single
version, single train) and are tested against each other at exactly that version.
Consumers (map-editor, easy6502) implicitly follow the train via lockfiles. But the
policy is nowhere stated: nothing tells an external consumer that mixing
`@gjsify/fetch@0.14.x` with `@gjsify/http@0.13.x` is unsupported, and the first
consumer who bumps packages individually becomes a bug-report generator for
combinations we never test.

Related but distinct: `@girs/*` pinning. The historical need for exact pins (rc
prerelease sorting above stable under semver ranges) was fixed at the source by
ts-for-gir's version-scheme change (#432 — release-only versions, `libraryVersion`
as a field). That scheme is now published (`@girs/*` at `4.1.0`, plain semver),
so caret ranges on `@girs/*` are safe and gjsify has relaxed its exact pins to
`^4.1.0` (see Decision 4 — DONE).

## Decision

1. **Framework-style versioning, stated as policy:** `@gjsify/*` packages are
   released as a coherent train. Compatibility between `@gjsify/*` packages is
   guaranteed ONLY within the same release version. Consumers upgrade all
   `@gjsify/*` deps together (`gjsify upgrade --latest --filter @gjsify` bulk-bumps
   every `@gjsify/*` dep; `gjsify upgrade --align` repairs drift — these are the
   supported tools for exactly this. Note: `--filter <name>` matches the DEP name;
   `-p`/`--workspace` filters WORKSPACES, not deps).
2. **Intra-workspace ranges reflect the train:** workspace deps stay `workspace:^`
   (published as caret of the train version); the policy line — not tighter ranges —
   is what communicates the contract. We deliberately do NOT adopt per-package
   independent semver: with ~112 packages and one maintainer, honest independent
   semver is not achievable, and pretending otherwise is worse than the train.
3. **Documented where consumers look:** the workspace README, the website
   ("Versioning & compatibility" page), and the `create-app` template README get the
   two-sentence policy + the `gjsify upgrade --align` recipe.
4. **`@girs/*`:** ~~keep exact pins until the ts-for-gir release-only version scheme
   (#432) has shipped and been verified against dedupe/caret behavior; then relax to
   caret in one dedicated PR (lockfile diff reviewed against the known churn
   failure mode).~~ **DONE** — the release-only scheme is published (`@girs/*` at
   `4.1.0`, `libraryVersion` field carrying the GNOME lib version). Every `@girs/*`
   pin was relaxed to `^4.1.0` caret; the lockfile dedupes to one version per package
   (the historical duplicate-`@girs/gobject-2.0` TS2345 failure mode is gone). The two
   custom types not yet republished under the new scheme (`@girs/gwebgl-0.1`,
   `@girs/gjsifywebrtc-0.1`, still `0.1.0-4.0.0-rc.5`) stay pinned until they migrate.
5. **Optional peers** (e.g. `@nativescript/core`, `vite`) keep their own honest
   ranges — they are external and not on the train.

## Consequences

- The support surface for version combinations collapses from combinatorial to
  linear — matching what CI actually tests.
- External consumers get an explicit, cheap rule instead of an implicit lockfile
  convention; issues from mixed versions can be closed against policy.
- Tightening is one-way-safe: if a future ecosystem needs independent semver for a
  subset (e.g. Tier-1 pillars only), that can supersede this ADR — the reverse
  (walking back independent-semver promises) would not be.

## Consequences for tooling

- `gjsify upgrade --check` already gates cross-workspace range consistency; extend
  the docs to mention it as the consumer-side train check.

## Implementation

1. ~~Policy text: README + website page + create-app template (one docs PR).~~ ✓
2. ~~`@girs/*` caret relaxation PR gated on ts-for-gir #432 verification.~~ ✓ (scheme
   published at `4.1.0`; exact pins → `^4.1.0`; lockfile dedupe verified).
3. ~~Reference this ADR from the AGENTS.md release/publish section.~~ ✓
