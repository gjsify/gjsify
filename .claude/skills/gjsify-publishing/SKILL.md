---
name: gjsify-publishing
description: Read BEFORE adding a new @gjsify/* package name, before running `gjsify onboard`/`gjsify publish`/`gjsify trust`, and before cutting or re-running a release. Covers the manual npm first-publish + Trusted Publisher bootstrap that OIDC requires, and the publish-order/closure rules that keep a partial release from shipping an unresolvable tree. Triggers: "new package", "first publish", "trusted publisher", "onboard", "release", "publish sweep", "release.yml failed".
---

# gjsify — publishing and releases

Two failure modes here have each stalled the release train for every alphabetically later
package. Both are documented in full, with the measured incidents, in
[docs/publishing.md](../../../docs/publishing.md) — **read that file now**, then act.

The two things to check before you do anything:

1. **Adding a new `@gjsify/*` name?** npm Trusted Publishing (OIDC) requires the package to
   ALREADY EXIST, so the first publish is a manual maintainer action, not CI. Run
   `gjsify onboard` (idempotent, `--dry-run` first). Skipping it makes `release.yml`'s OIDC
   exchange 404 and exits 1 — the v0.4.20 incident left 60+ packages stuck at 0.4.19.

2. **Cutting a release?** A publish sweep has no transaction, so its ORDER is a correctness
   property. `npm:publish` must run `gjsify foreach --topological` with `includeOptional`
   (the default) so platform children publish before their bridge; otherwise an abort leaves a
   live bridge pinning a child that does not exist, and npm SILENTLY SKIPS an unresolvable
   `optionalDependency` — the install succeeds and the consumer gets a bridge with no dylib.
   Recovery from a partial sweep is a re-run with `--tolerate-republish`.

Release cuts happen from CI (`release-cut.yml`), never locally.
