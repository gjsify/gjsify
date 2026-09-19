---
name: gjsify-publishing
description: Read BEFORE adding a new @gjsify/* package name, before running `gjsify onboard`/`gjsify publish`/`gjsify trust`, and before cutting or re-running a release. Covers the manual npm first-publish + Trusted Publisher bootstrap that OIDC requires, and the publish-order/closure rules that keep a partial release from shipping an unresolvable tree. Triggers: "new package", "first publish", "trusted publisher", "onboard", "release", "publish sweep", "release.yml failed".
---

# gjsify — publishing and releases

Two failure modes here have each cost a release in this repo. One stalled a train; the other
SHIPS one, which is worse and is the live risk ([#1713](https://github.com/gjsify/gjsify/issues/1713)).
Both are documented in full, with the measured incidents and their dates, in
[docs/publishing.md](../../../docs/publishing.md) — **read that file now**, then act.

The two things to check before you do anything:

1. **Adding a new `@gjsify/*` name?** npm Trusted Publishing (OIDC) requires the package to
   ALREADY EXIST, so the first publish is a manual maintainer action, not CI. Run
   `gjsify onboard` (idempotent, `--dry-run` first). Skipping it makes `release.yml`'s OIDC
   exchange 404 — which, since `fb3034a205` added `--tolerate-untrusted-new` (2026-05-22), the
   sweep TOLERATES: it skips the name with exit 0 and publishes its dependents behind it. Do not
   expect a red leg to stop you. The exit-1 stall is the v0.4.20 incident (2026-05-21, 60+
   packages stuck at 0.4.19) and is the reason the flag exists, not what happens now.

2. **Cutting a release?** A publish sweep has no transaction, so its ORDER is a correctness
   property. `npm:publish` must run `gjsify foreach --topological` with `includeOptional`
   (the default) so platform children publish before their bridge; otherwise an abort leaves a
   live bridge pinning a child that does not exist, and npm SILENTLY SKIPS an unresolvable
   `optionalDependency` — the install succeeds and the consumer gets a bridge with no dylib.
   Recovery from a partial sweep is a re-run with `--tolerate-republish`.

Release cuts happen from CI (`release-cut.yml`), never locally.
