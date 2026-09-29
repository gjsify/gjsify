<!-- Authored Open-TODO sections — area: Architecture roadmap.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### Architecture backlog — ADRs 0001–0008

Decisions in [docs/adr/](../docs/adr/README.md), prioritized backlog in [docs/reports/2026-07-01-architecture-review.md](../docs/reports/2026-07-01-architecture-review.md). Remaining open work (resolved sub-items are recorded in the commits/CHANGELOG that closed them):

- **ADR 0001 (P1)** — install non-destructive invariant: the Phase D.8 dedup pass is still open (the e2e guards, per-prefix lock, atomic writes and conflict warning have landed).
- **ADR 0006 (P1)** — per-package build cache: **CI wiring DEFERRED** — enabling it on the `main.yml` build steps timed out the serial `Build examples` step (cold cache + per-package closure re-hashing at scale). Remaining: (a) memoize input hashes across a single `foreach` before re-enabling in CI; (b) phase 2 = source-direct workspace-consumption spike.
- **ADR 0003 (P1)** — tiering shipped; the website still lacks a per-package tier index (the tier model is documented on the versioning page).
- **ADR 0002 (P1) — DONE.** Both big bundles are untracked; CI and a fresh clone
  bootstrap from the published gjsify. Read the **second amendment** (2026-08-06):
  it withdraws decision 1 (no `bootstrap/bootstrap.gjs.mjs`) because the
  lockfile-reader wedge that required a same-commit installer is closed and
  machine-checked by `scripts/check-lockfile-reader-lead.mjs`. #1002 is closed as
  superseded; the one measurement worth keeping from it lives in the ADR.
  Residual: the `--determinism` mode owed to `release-cut.yml` (see the bundle
  determinism entry above).
- **ADR 0007 (P3, easy6502)** — superseded into the full Learn6502 app-web rewrite (own project). Foundation pieces (phone-shell trio, `<adw-source-view>`) have landed on adwaita-web; remaining: the app-web view implementations over these + the classic-tutorial removal + the learn-package HTML target.

(ADRs 0004, 0005 and 0008 are fully implemented.)

