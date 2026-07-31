# ADR 0005 — node-gi (Axis 5) stays experimental and dependency-isolated

- **Status:** Accepted (2026-07-01); **graduated Tier 3 → 2 (2026-07-14)** — see Graduation below
- **Scope:** `packages/node-gi/*`, `--app node` reverse-bridge integration

## Context

node-gi inverts the ecosystem's thesis: instead of Node APIs on GJS, it runs
GObject-Introspection APIs on Node (N-API engine vendored from node-gtk, retargeted
to girepository-2.0). The headless core is real — 186 test cases, a byte-identical
dual gjs/node example, `gjsify storybook --runtime node` as e2e — and the build
integration is deliberately conditional (a `--app node` bundle that doesn't use GJS
ambient globals stays node-gi-free).

The risk is strategic, not technical: if node-gi becomes a first-class consumption
pattern, the test/maintenance matrix effectively doubles (every GJS-targeting
package must validate the reverse direction too), and the remaining hard problems
(toggle-ref/multi-env teardown crash, vfunc OUT/INOUT chain-up, GTK/Cairo layer)
sit in the most crash-prone corner of the codebase. Meanwhile its *proven* value
today is narrower: CI/benchmarking where GJS isn't available, dev tooling
(storybook-on-node), and the dual-build proof itself.

## Decision

1. **node-gi is Tier 3 (experimental) under ADR 0003** and is positioned as such
   everywhere it is documented: its ROI today is CI, benchmarks, and dev tooling —
   not production apps.
2. **Dependency isolation is an invariant:** no Tier-1 or Tier-2 package may take a
   hard dependency (deps/optionalDeps) on `@gjsify/node-gi`. Allowed seams are
   exactly the existing ones — devDependency for a `--runtime node` dev flow
   (storybook showcase pattern) and the conditional `--app node` build injection.
3. **The node-gi-free guarantee for cross-platform Node bundles is contractual:**
   the existing e2e guards (`node-gi-globals-inject`, `node-gi-girs-resolve`) are
   the enforcement and must not be weakened; conditional injection stays the only
   mechanism (never eager).
4. **Graduation gate (Tier 3 → 2):** the deferred crash-prone items fixed
   (toggle-ref/multi-env teardown, vfunc OUT/INOUT chain-up — each review-gated,
   done fresh per the authored status note), the GTK/Cairo layer landed, AND a second
   real consumer using the dual-build in anger. Until all three: no scope growth
   beyond the roadmap in `status/open-todos.md`.

## Consequences

- The base ecosystem cannot be destabilized by the experiment — the failure domain
  is bounded to opt-in users.
- Expectations are honest: nobody builds a production server on node-gi because a
  storybook demo worked.
- The track keeps moving (roadmap in `status/open-todos.md`), but investment is paced by the
  graduation gate instead of by enthusiasm.

## Implementation

1. Mark tier + "experimental — CI/benchmark/dev-tooling scope" in
   `packages/node-gi/*` READMEs and the website.
2. Add the dependency-isolation rule to the ADR-0003 audit check (name
   `@gjsify/node-gi` explicitly).
3. Keep `node-gi.yml` as the isolated CI owner (already the case via the classifier
   carve-out).

## Graduation (2026-07-14)

The Tier 3 → 2 gate (Decision 4) is met — all four items landed:

1. **Toggle-ref / multi-env teardown crash fixed** (#730) — the process-exit crash
   was a single-thread live-env race (`CleanupHandles()` dispatched the pending
   drain before the env-cleanup hook could flip the shutdown flag); fixed with a
   side-effect-free JS-availability probe + the three C→JS re-entry trampolines
   degrading to a no-op when JS is unavailable. Independently adversarially
   reviewed (0 aborts in 320 stress runs; pre-fix mechanism reproduced 20/20).
2. **vfunc OUT/INOUT chain-up** (#732) — `super.vfunc_x(...)` with OUT/INOUT args
   now marshals per-arg slots (mirroring the function-invoke path) instead of a
   "not yet supported" throw.
3. **GTK/Cairo layer** (#733) — the cairo foreign-struct seam + Context/Surface
   binding; byte-identical pixel parity with GJS, and a `Gtk.DrawingArea` draw-func
   receives a real `cairo.Context` across the GI boundary.
4. **Second real consumer** (#734) — `@gjsify/sqlite`'s own test suite runs on
   node-gi via `--app node` (real `Gda.Connection`/`SqlParser`/`DataModel`), a
   `devDependency`-only seam, in the isolated `consumer-sqlite` CI job.

**`@gjsify/node-gi` is now Tier 2** (`package.json#gjsify.tier: 2`): best-effort,
released on the train, breaking changes ship with a minor + changelog note.

**Decision 2 (dependency isolation) is RETAINED unchanged.** Graduation reflects
node-gi's own API maturity, not a new consumption pattern: the reverse bridge would
still double the runtime test matrix if Tier-1/2 packages hard-depended on it, so
`dependencies`/`optionalDependencies` on `@gjsify/node-gi` stay forbidden (the
`audit-runtimes.mjs` rule that names it explicitly is unchanged). The sanctioned
seams remain a `devDependency` and the conditional `--app node` build injection.

Follow-ups (tracked in `status/open-todos.md`, none gate-blocking): the narrowed
`worker.terminate()`-mid-native-call residual, Gio.DBus overrides, GObject/GLib
override parity, GValue BLOB byte-array marshalling, INOUT containers, and the
website node-gi page.
