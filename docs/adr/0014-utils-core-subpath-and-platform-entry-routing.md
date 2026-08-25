# ADR 0014 — Cross-runtime reachability: a `@gjsify/utils/core` subpath, `polyfill`-slot platform-entry routing, and a machine-checked invariant

- **Status:** Accepted (2026-07-26)
- **Scope:** `@gjsify/utils` (Tier 1, `packages/gjs/`) and its 27 in-workspace consumers; the derived alias layer in `@gjsify/resolve-npm` (`lib/runtime-aliases.mjs`); the `src/browser.ts` platform entries under `packages/node/*`; `scripts/audit-runtimes.mjs`. Binds the meaning of the `polyfill` slot in `package.json#gjsify.runtimes` and introduces one new declarative field, `gjsify.runtimeSubpaths`.
- **Supersedes nothing.** Extends the slot model of AGENTS.md `## Strategic direction — cross-runtime portability` and applies the "Pure-JS → native swap" rule from AGENTS.md `### Don't patch — implement at the source`.

## Context

Item **E2** of `docs/reports/2026-07-11-code-quality-audit.md` — the last open
architectural finding — reported that browser-slotted `packages/node/*` packages
statically import the GJS-only `@gjsify/utils`, so "a `browser:polyfill` slot resolves
to the GJS impl at bundle time, and any util touching GLib/Gio breaks at call time
off-GJS". It proposed two remedies (a `-core` split of `@gjsify/utils`, or routing the
browser slot through the packages' existing `./browser` subpaths) and asked for an ADR
before implementation.

Before choosing, the two premises were measured rather than assumed.

### Measurement 1 — the real pure-vs-GJS split of `@gjsify/utils`

The audit named four plausibly-pure helpers (`makeCallable` / `nextTick` /
`queueMicrotask` / `registerGlobal`). Classifying all 16 modules by whether they take a
top-level `@girs/*` **value** import or an unguarded `imports.*` read gives a very
different picture — the pure surface is **four times** what the audit assumed:

| Class | Modules | Exports |
|---|---|---|
| **PURE** — no platform dependency at all | `callable`, `defer`, `error`, `gio-errors`, `globals`, `message`, `microtask`, `structured-clone` | `makeCallable`, `deferEmit`, `initErrorV8Methods`, `GIO_ERROR_TO_NODE`, `GLIB_FILE_ERROR_TO_NODE`, `createNodeError`, `createGLibFileError`, `isNotFoundError`, `ErrnoException`†, `NodeErrorDetails`†, `registerGlobal`, `notImplemented`, `warnNotImplemented`, `queueMicrotask`, `structuredClone` |
| **GJS-GUARDED** — probes `globalThis.imports?.gi`, portable fallback | `main-loop`, `next-tick` | `ensureMainLoop`, `quitMainLoop`, `nextTick`, `__resetBurstStateForTests` |
| **GJS-HARD** — top-level `@girs/*` value import or bare `imports.*` | `byte-array`, `cli`, `file`, `fs`, `gio`, `path` | `gbytesToUint8Array`, `cli`, `readJSON`, `existsFD`, `existsSync`, `gioAsync`, `readBytesAsync`, `inputStreamAsyncIterator`, `resolve`, `getProgramExe`, `getProgramDir`, `getPathSeparator`, `getNodeModulesPath` |

† type-only.

The instructive entry is `gio-errors.ts`: despite the name it is **entirely pure** — a
numeric `Gio.IOErrorEnum` → errno table with a comment explaining that the numbers are
inlined precisely "to avoid importing Gio just for error handling (keeps this usable in
Node.js tests too)". Five of the ten surviving GJS-barrel importers use only this
module. Splitting on the package name would have moved it to the wrong side.

### Measurement 2 — the real blast radius

37 files under `packages/node/*/src` import `@gjsify/utils`. Cross-referencing *which
export* each one imports against the table above, and against the importing package's
declared browser slot, the count of imports that actually reach a GJS-hard helper from
a non-`none` browser slot is **nine**, in five packages:

| Package | browser slot | GJS-hard helper reached |
|---|---|---|
| `@gjsify/os` | **`polyfill`** | `cli` (×3 — `index`/`linux`/`darwin`), `getPathSeparator` |
| `@gjsify/fs` | `partial` | `existsSync` |
| `@gjsify/http` | `partial` | `readBytesAsync` |
| `@gjsify/module` | `partial` | `resolve`, `readJSON` |
| `@gjsify/fetch` | `native` | `inputStreamAsyncIterator` — **not a leak**: `native` routes to `globals.mjs`, the polyfill body is never bundled |

So exactly **one** package genuinely violates the invariant as stated
(`browser: "polyfill"` + GJS-hard reachability): `@gjsify/os`. Everything else is
`partial` (a weaker promise), `native` (routed away), or `none`.

The remaining 28 import sites are pure or guarded — they are noise in the audit's
"22 browser-slotted packages" framing, not leaks.

### Measurement 3 — the decisive one

**Every package in that violation table already ships a real `src/browser.ts` and a
`./browser` export subpath, and none of those browser entries imports `@gjsify/utils`
at all.** There are 14 such entries across `packages/node/*`, totalling 3409 lines of
genuine browser implementation (`os/src/browser.ts` is a complete browser `os`;
`stream/src/browser.ts` is a 517-line EventEmitter-backed stream polyfill).

Nothing routes to any of them. The root `.` export has no `"browser"` condition, none of
the packages declares a top-level `"browser"` field, `ALIASES_NODE_FOR_BROWSER` maps
`stream` → `@gjsify/stream` (the root), and `resolveSlot` treated `polyfill` as a
no-op. `stream/src/browser.ts`'s own header even asserts *"This module is the
`@gjsify/stream` entry the bundler picks up when `gjsify build --app browser` resolves
`stream`"* — which was simply not true. This is the audit's companion observation, and
it is not a separate problem: **it is the missing half of the fix.**

### Why the leak is silent

On `--app browser` and `--app nativescript`, `gjsImportsEmptyPlugin` resolves `@girs/*`
and `gi://*` to `export {}; export default {};`. So `import GLib from '@girs/glib-2.0'`
yields `{}` — not `undefined`, and not a build error. Nothing fails at bundle time,
nothing fails at load time, and a grep of the bundle for `gi://` or `@girs/` comes back
**clean**. The leak only ever surfaces as `TypeError: GLib.spawn_command_line_sync is
not a function` the first time a consumer calls `os.cpus()`. That silence is the entire
reason this needs a static guard rather than a test.

## Decision

### 1. Split `@gjsify/utils` at the module level via a `./core` **subpath**, not a new package

`packages/gjs/utils/src/core.ts` re-exports exactly the PURE + GJS-GUARDED modules;
`src/index.ts` re-exports `./core.js` plus the six GJS-HARD modules, so the existing
`@gjsify/utils` surface is **byte-identical** and no consumer breaks. Every consumer
whose imports are entirely pure/guarded was repointed to `@gjsify/utils/core`.

The membership rule is mechanical: a module belongs in `core` iff calling **any** of its
exports on a runtime without GLib/Gio is well-defined — either no platform dependency at
all, or a guarded probe with a portable fallback.

**A subpath, deliberately not a new published package.** AGENTS.md's "Pure-JS → native
swap" rule names both shapes, and here the subpath is the right one. A new `@gjsify/*`
name does carry real overhead — listed next as CONTEXT, not as the reason:

- it needs a tier and a runtime quadruplet;
- it needs a **manual npm first-publish + Trusted Publisher bootstrap by a maintainer
  before the next release**, because npm's OIDC trusted publishing cannot be configured
  for a name with no published versions;
- getting that wrong does not fail locally — it breaks the **entire serialized
  `npm:publish` loop** in `release.yml` for every package alphabetically after the new
  name. This has actually happened here: `@gjsify/tls-native` was added in #242 without
  the bootstrap and 60+ packages stalled at 0.4.19 (the v0.4.20 incident).

`@gjsify/utils-core` would have bought a name that sorts between `@gjsify/util` and
`@gjsify/utils` — i.e. directly in front of `utils`, `uuid`, `v8`, `vm`, `web-*`,
`webassembly`, `webaudio`, `webcrypto`, `webgl`, `webrtc`, `webstorage`,
`worker_threads`, `ws` and `zlib` — in exchange for zero additional capability over a
subpath.

**What tipped the decision is the structural criterion below, not the release cost
above.** An earlier revision of this ADR said the release-train cost tipped it; that is
withdrawn. The bootstrap is a step in shipping a name and `gjsify onboard` is idempotent,
so it cannot be allowed to decide where code lives — otherwise the package tree is
shaped by a release chore. The precedent the audit cites,
`@gjsify/canvas2d-core` ⇆ `@gjsify/canvas2d`, is a genuinely different case: it exists to
break a *package-level dependency cycle* (`dom-elements` ↔ `canvas2d`) and both halves
have independent external consumers. Neither is true here — nothing outside the
workspace consumes `@gjsify/utils`, and there is no cycle.

The trade-off accepted: a subpath cannot carry its own `gjsify.runtimes` block, so the
slot model gains one small field to compensate (decision 4).

### 2. `slot: "polyfill"` on a non-GJS target routes to the package's platform entry

In `@gjsify/resolve-npm`'s `resolveSlot`, `polyfill` on a target other than `gjs` now
resolves `@gjsify/<X>` → `@gjsify/<X>/<target>` whenever the package's `exports` map
declares that subpath. `gjs` is never rerouted — `src/index.ts` *is* the GJS impl.

This is the semantic that `polyfill` always claimed: *"our implementation fully covers
this API on this runtime"*. A package can only keep that promise off GJS if the code the
target resolves is GLib-free, and a package that has gone to the trouble of writing
`src/browser.ts` has already done exactly that. Four packages route today:
`@gjsify/{os,process,stream,vm}` on `browser`.

`@gjsify/os` — the one real violation — is fixed by this and nothing else. Repointing
its imports could not have fixed it: `os` genuinely needs `cli` and `getPathSeparator`
on GJS. That is why the `-core` split alone was **not** sufficient (see "Alternatives").

### 3. `slot: "partial"` deliberately does **not** route

`partial` is the weak promise — "works here, degrades" — and the shared body's
degradation *is* its contract, exactly as `resolveSlot`'s `none` branch already
documents. Two concrete reasons not to extend routing to it:

- **It would break builds.** The `partial` packages' browser entries are not at export
  parity with their root entries: `@gjsify/fs`'s `src/browser.ts` is missing 34 value
  exports (`cp`, `opendir`, `statfs`, `writev`, …), `@gjsify/zlib`'s is missing 6,
  `@gjsify/https`' is missing 2. Routing them converts a call-time degradation into a
  build-time `MISSING_EXPORT`.
- **Parity is the honest promotion gate.** Reaching export parity is precisely the work
  that earns a package the `partial` → `polyfill` promotion, at which point routing
  picks the entry up automatically.

So the ten unrouted platform entries are not dead code — they are the promotion path,
and decision 4 makes the audit print them on **every** run so they cannot quietly rot
again.

### 4. Subpath-level slot declarations — `package.json#gjsify.runtimeSubpaths`

```jsonc
"gjsify": {
  "runtimes":       { "gjs": "polyfill", "node": "none", "browser": "none", "nativescript": "none" },
  "runtimeSubpaths": {
    "./core":      { "gjs": "polyfill", "node": "polyfill", "browser": "polyfill", "nativescript": "polyfill" },
    "./main-loop": { "gjs": "polyfill", "node": "polyfill", "browser": "polyfill", "nativescript": "polyfill" }
  }
}
```

`@gjsify/utils` now declares slots for the first time (it declared none at all, so the
model had no opinion on it), and honestly: the package as a whole is GJS-only. The new
field lets a GJS-runtime package expose a genuinely cross-runtime slice without the
package claiming a slot it cannot keep. It is read by the audit only — the bundler's
alias layer keys on exact package specifiers, and subpath imports already bypass it.

### 5. The invariant is machine-checked in `scripts/audit-runtimes.mjs`, on plain `--check`

A new "Cross-runtime reachability audit" section (kept separate from the platform audit)
enforces:

| Check | Rule | Severity |
|---|---|---|
| `gjs-only-reach` | the target-resolved source of a slot must not have a direct `@girs/*` / `gi://` / unguarded `imports.*` binding, nor import a `@gjsify/*` package that is both declared `none` for the target **and** itself hard-bound to GJS | **fatal** for `polyfill` on `browser`/`nativescript`; reported otherwise |
| `platform-entry-unreachable` | `src/<target>.ts` must not exist without a matching `"./<target>"` export subpath | **fatal** |
| `platform-entry-parity` | a slot that routes to `src/<target>.ts` — every VALUE export of the root entry must exist on the platform entry | **fatal** |

"Target-resolved source" is the point: when a slot routes (decision 2) the audit walks
the local module graph rooted at `src/<target>.ts` only, so `@gjsify/os`'s GJS-bound
`src/index.ts` is correctly *not* held against its browser slot. When it does not route,
all of `src/**` is scanned.

It runs on plain `--check`, alongside the tier and platform audits, rather than behind
`--strict`. `--strict`'s existing probes are parked behind a flag because 26 packages
cannot satisfy `no-browser-test` yet; this audit passes on the current tree, is cheap
(a static import scan, no build, no evaluation), and CI invokes `--check`. **A guard
that only runs in a mode CI does not use is not a guard.**

## Consequences

- `@gjsify/os` on `--app browser` now resolves `os/src/browser.ts`. `os.cpus()`,
  `os.platform()` and friends return browser-appropriate values instead of throwing.
  `@gjsify/{process,stream,vm}` likewise.
- Ten `@gjsify/utils` importers remain, and after this change **all ten genuinely need
  GLib/Gio**. The barrel import is now a meaningful signal rather than a default.
- `@gjsify/utils` is Tier 1 and gains a published subpath. `./core` is additive; no
  existing export moved or changed shape.
- Two pre-existing findings were surfaced by the new audit and are **reported, not
  enforced**, with the reason printed on every run:
  - nine `partial` browser slots reach GJS-only code — by design, per decision 3;
  - `@gjsify/web-globals` declares `node: "polyfill"` while re-exporting
    `@gjsify/webaudio` (`node: "none"`, hard-bound: `gi://Gst?version=1.0` +
    a top-level `Gst.init(null)`). This is a genuine defect, but its failure mode on
    `--app node` is **loud** — `gjsGiNodePlugin` rewrites `gi://` to `requireGi(…)`
    against the external `@gjsify/node-gi`, so the bundle fails at module load rather
    than silently yielding `{}`. It needs a `packages/web/` fix (slot downgrade or a
    `src/node.ts` entry) that is outside this change's blast radius.
- `@gjsify/terminal-native` is imported by `@gjsify/process` (`nativescript:
  "polyfill"`) and declares `nativescript: "none"`. This is **not** a violation and the
  audit does not flag it: `terminal-native` reaches GJS only through a guarded
  `globalThis.imports?.gi` probe and exports `null` off GJS. Encoding that distinction
  (`hardGjs`) is what keeps the check free of false positives — it reuses the same
  signal vocabulary (`GJS_IMPORTS_GUARD_RE` / `DYNAMIC_GI_RE`) the drift check already
  relies on.

### What the check does not catch

- **Dynamic imports and non-static reachability.** The walk follows static `import` /
  `export … from` only.
- **Third-party leaks.** Only `@gjsify/*` edges carry slot declarations; a GJS-bound
  npm dependency is invisible to it.
- **Runtime behaviour.** It proves no GLib/Gio *code* is reachable; it does not prove
  the platform entry is *correct*. That is what `tests/browser/` is for.
- **Export parity beyond routed slots**, and value-vs-type classification is
  regex-based (it follows local `export *` but does not type-check).
- **Grepping the built browser bundle for `gi://` / `@girs/` does not detect this bug**
  and never did — `gjsImportsEmptyPlugin` rewrites both to a virtual empty module before
  they can reach the output. The bundle greps clean whether or not the leak is present.
  That is exactly why the guard has to be static and declaration-driven.

## Implementation

| Area | Change |
|---|---|
| `packages/gjs/utils/src/core.ts` | new — cross-runtime barrel (PURE + GJS-GUARDED modules) |
| `packages/gjs/utils/src/index.ts` | re-exports `./core.js` + the six GJS-HARD modules; surface unchanged |
| `packages/gjs/utils/package.json` | `"./core"` export; first `gjsify.runtimes` declaration; new `gjsify.runtimeSubpaths` |
| 27 consumer files across `packages/{node,web,framework}/*/src` | repointed to `@gjsify/utils/core` |
| `packages/node/stream/src/browser.ts` | adds the `'module.exports'` CJS-interop export the root entry has — required now that the browser slot actually routes here |
| `packages/infra/resolve-npm/lib/runtime-aliases.mjs` | `PackageRecord.platformEntries`; `resolveSlot` routes `polyfill` → `<pkg>/<target>` |
| `scripts/audit-runtimes.mjs` | new cross-runtime reachability audit, wired into plain `--check` |

Follow-ups belong in `status/open-todos.md`, not here: the `@gjsify/web-globals`
`node` slot defect, and the per-package parity work that promotes the ten `partial`
browser entries to `polyfill`.
