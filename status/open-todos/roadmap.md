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


### Decide whether a WebAssembly backend gets an ADR

The [GObject-in-Wasm prototype](../../docs/reports/2026-10-27-gobject-wasm-prototype.md)
answered the feasibility question and hit no wall: `registerClass`, `notify::`, `connect`,
`emit` and a typelib namespace all work through the shipping `gi.js`, on Node, headless
Chromium 149 and headless Firefox 151, single-threaded and with **no cross-origin
isolation** (both browser runs report `cross_origin_isolated: false`). ~1.4 MB gzipped for
the whole engine; ~90 ms startup; ~3 ms per namespace.

What is open is not *can we* but *what is it for*. `emit` costs ~3,700 ns against ~16 ns
for a plain-JS object — but the same `emit` measured in C inside the same wasm module
costs **88 ns**, so ~98 % of that is the N-API boundary and not Wasm. That rules out
driving a UI at frame rate and rules in tooling, test harnesses, executable docs and a
playground. It also says the boundary cost is worth its own thread of work, since the
native build pays it too.

Inputs the ADR needs, all in the prototype:

- four GLib patches (111 insertions / 6 files) on top of wasm-vips' series —
  `docs/poc/gobject-wasm/patches/README.md`. **0002 is correct on every platform** and is
  the one worth sending upstream as written; per the third-party rule, none were filed.
- the node-gi side is nearly free: 14 of 16 `.cc` unchanged, 2 shimmed, one host file,
  one `#ifdef` helper. See `node-gi.md` for what the seam still owes.
- iOS does **not** want this: the NativeScript iOS 9.x engine is jitless JSC, and an iOS
  app can link static native GLib anyway. Two backends behind one binding layer, not one
  technique stretched over both. (Reasoned, not measured.)

The [boundary report](../../docs/reports/2026-10-27-gobject-wasm-boundary.md) splits the
per-call cost by layer: cheap fixes give ~20 %, not 10×; the notify crossing into JS is the
big Wasm-specific item. Todos in [node-gi.md](node-gi.md).
