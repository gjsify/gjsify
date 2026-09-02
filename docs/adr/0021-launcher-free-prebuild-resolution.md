# ADR 0021 — native prebuilds resolve in-process; the launcher becomes an optimisation

- **Status:** Accepted (2026-08-06)
- **Scope:** `packages/infra/cli/src/utils/gi-search-path.ts` (new), `bundler-pick.ts`
  (`tryLoadNative`, `diagnoseNativeEngine` branch 3), `utils/oxc-resolve.ts`
  (`tryLoadNativeOxfmt`), `tests/e2e/launcher-free-build/`. Extended 2026-09-02 to the
  Node host: `packages/node-gi/node-gi/native-prebuilds.js` — see "The Node host".
  **No artifact changes** — see "What is deliberately NOT changed".

## Context

Under GJS, `gjsify build` needs `@gjsify/rolldown-native`'s prebuild. Until now that
resolved only when the process was started through the `gjsify` launcher, which exports
`GI_TYPELIB_PATH` and the host's library-path variable before `exec` (`bin-shim.ts`,
`buildNativeEnvPreamble`). Invoked any other way — `gjs -m …/dist/cli.gjs.mjs build …`,
which is what several e2e suites do — the build died with *"no usable bundler engine
under GJS"*.

Measured on this tree (gjs 1.88.1, GLib 2.88.3, `@gjsify/rolldown-native-linux-x64`),
importing `gi://GjsifyRolldown` from a bare `gjs -m`:

| environment | result |
|---|---|
| neither variable | `Typelib file for namespace 'GjsifyRolldown' (any version) not found` |
| `GI_TYPELIB_PATH` only | `Failed to load shared library 'libgjsifyrolldown.so' referenced by the typelib` → surfaced to JS as `Unsupported type void, deriving from fundamental void` |
| both | loads |

**There are two lookups, not one**, and they fail differently. That distinction is what
the previous answer collapsed.

That answer — *"the typelib lookup happens inside the GJS runtime, so those must be set
BEFORE the process starts; the CLI cannot repair it from the inside"* — was written into
`bundler-pick.ts`'s diagnostic, `packages/infra/cli/AGENTS.md`, and ~30 per-target package
READMEs. For `LD_LIBRARY_PATH` it is true and stays true: `ld.so` freezes its search path
at process start. That is an OS property, not a GJS one, and nothing here changes it.

**It is nevertheless the wrong frame, because girepository does not delegate either lookup
to the loader's environment.** It keeps two search paths of its own — one for typelibs,
one for the shared libraries those typelibs name — and consults both *before* falling back
to the system loader. Both are writable at runtime:

- `gi_repository_prepend_search_path()` — the typelib half (GLib 2.80)
- `gi_repository_prepend_library_path()` — the library half (GLib 2.80), documented as
  *"If the library is not found in the directories configured in this way, loading will
  fall back to the system library path (i.e. `LD_LIBRARY_PATH` and `DT_RPATH` in ELF
  systems)"*

The second is the one nobody went looking for, because `LD_LIBRARY_PATH` was assumed to
BE the mechanism. It is only the fallback. The row above where `GI_TYPELIB_PATH` alone
fails is the proof that girepository's library path starts empty — no environment variable
seeds it, so today `LD_LIBRARY_PATH` is the only thing answering that half.

Verified end-to-end with **no `GI_TYPELIB_PATH` and no `LD_LIBRARY_PATH` in the
environment**: after `dup_default().prepend_search_path(dir)` +
`prepend_library_path(dir)`, `gi://GjsifyRolldown` imports and `new Bundler()` constructs.

### What is deliberately NOT changed: the `$ORIGIN` rpath

An rpath was the expected fix and it is **not** the fix, for a reason worth recording so it
is not re-proposed: it is already present, and it already does a different job.

```
$ readelf -d packages/infra/rolldown-native-linux-x64/prebuilds/linux-x64/libgjsifyrolldown.so
 (NEEDED)   Shared library: [libgjsify_rolldown.so]
 (SONAME)   Library soname: [libgjsifyrolldown.so]
 (RUNPATH)  Library runpath: [$ORIGIN]
```

`packages/infra/rolldown-native/meson.build` has set `build_rpath`/`install_rpath` since the
bridge was written, and its sibling `lightningcss-native/meson.build:30-33` records why: the
Vala library must find the Rust cdylib shipped beside it, and on macOS nothing sets
`DYLD_LIBRARY_PATH`, so the rpath is the only thing that finds it. It is not merely present,
it is already machine-checked — `scripts/check-prebuild-loader-path.mjs` and
`tests/e2e/prebuild-loader-path/` exist precisely to hold every shipped prebuild to it.

That rpath structurally cannot help gjs FIND `libgjsifyrolldown.so` itself. The typelib
names the library by bare SONAME, and `dlopen()` of a bare name searches the
`RPATH`/`RUNPATH` of the **calling** object — here libgirepository, whose `$ORIGIN` is
`/usr/lib64`. An rpath on the callee is not consulted to find the callee. **No prebuilt
artifact is modified by this ADR, so nothing has to be rebuilt, re-staged or re-published.**

## Decision

The CLI makes the prebuild directories it can already see resolvable to the **running**
process, through girepository's own two search paths, at the moment it first wants native
code.

One helper per HOST — on GJS, `activateNativePrebuilds()` in
`packages/infra/cli/src/utils/gi-search-path.ts` — memoized per process, feeding on
`detectNativePackages()`, the *same* function whose output the launcher turns into
environment variables. That symmetry is the design:

> **the in-process activation is the launcher's environment, applied to the process that is
> already running.** Same detection, same set, two mechanisms for two different processes.

It is therefore not per-bridge and there is no "which bridges are covered" list to maintain
or drift: every prebuild `detectNativePackages()` resolves is activated, which today is all
three engines the CLI loads in-process (`rolldown-native`, `lightningcss-native` via the
`css-as-string` plugin, `oxfmt-native`) plus any added later, for free.

Called from the two places the CLI loads native code, both already memoized so the ~65 ms
`detectNativePackages()` sweep is paid at most once, and only by a command that actually
wants an engine:

- `bundler-pick.ts` → `tryLoadNative()`
- `utils/oxc-resolve.ts` → `tryLoadNativeOxfmt()`

Availability is a **capability probe** where the answer is knowable — `dup_default()` is
GLib ≥ 2.86, so `typeof …dup_default !== 'function'` returns "not activated" rather than
throwing — and a **single documented `catch`** where it is not. Both throw paths are real,
not defensive, which is what the repo's anti-pattern rule demands of a kept catch:

1. `imports.gi.GIRepository` LOADS the namespace, and GJS raises *"Requiring GIRepository,
   version none: Typelib file … not found"* when that typelib is absent — verified by probe.
   It is a separate FILE from the girepository library GJS links against, and distributions
   split them (Debian ships `gir1.2-girepository-3.0` apart from `libgirepository-2.0-0`),
   so a lean host can have the second without the first.
2. The two `detectNativePackages()` walks are filesystem I/O (EACCES, a directory removed
   mid-walk).

Either would otherwise escape into `diagnoseNativeEngine()`, which documents that nothing it
calls may throw while explaining a failure — the diagnosis would have been replaced by a
stack. The result is memoized BEFORE the work, so every outcome is decided once.

Every one of those paths lands on the same behaviour: no activation, and the caller is
exactly where it was before this function existed. **The change is strictly additive — no
host gets worse.**

The GJS check is the probe itself (`globalThis.imports?.gi`, the spelling `.oxlintrc.json`
sanctions), not `isGjs()`: the question is "is there a GIRepository to prepend to", and a
plain Node process has none, which is the required no-op. It is NOT that a Node host wants
no prebuild — on darwin `@gjsify/webkit-native`'s prebuild is the only WebKit there is
(ADR 0022) — but that the repository this helper writes to lives in the addon, so the Node
host is answered where that addon is (§ The Node host).

### The Node host (added 2026-09-02)

The paragraph above says "on Node without node-gi the answer is no", and that carve-out
is now filled in. `@gjsify/node-gi` carries the same activation for the runtime ADR 0024
§ 4 puts macOS and Windows applications on: `native-prebuilds.js`, exporting a function
of the same name and the same contract — memoized, never fatal, `prependSearchPath` +
`prependLibraryPath`, no environment variable and no re-exec — called from `index.js`
once the addon is loaded. It is what makes a staged typelib resolve under a plain
`node app.mjs`, which passes through no launcher and no CLI at all.

Three differences from the GJS helper, each deliberate:

- **It cannot import `detectNativePackages()`.** node-gi is outside the npm workspace
  (ADR 0031) and must load with no dependency on the CLI, so the two decisions that
  matter — `prebuildDirCandidates()`' token order and `resolvePlatformSibling()`'s
  second pass — are COPIED, named in the module header, and pinned by
  `test/native-prebuilds.test.mjs` against the CLI's answers. A copy's only failure
  mode is drifting from what it copied, and it already has once: the declared-spelling
  probe compared raw strings, which made it dead code, and the host-libc probe kept
  probe 1 without probe 2, which reads a bun/deno/GJS host as musl.
- **One anchor, not two.** The GJS helper merges `process.cwd()` with its own
  directory because a globally installed CLI sits away from the project. node-gi is a
  library inside the application, so its own directory IS the application's tree, and a
  cwd anchor would make which typelibs load depend on the shell's working directory.
- **`gtk-runtime-*` is excluded.** Which GTK a process uses is `gtkSource()`'s decision
  (ADR 0023) applied in `gtk-runtime.js`; prepending that bundle a second time is the
  two-copies hazard #920 records.

**Measured on darwin, which is what closes "Nothing about macOS is proven here" below.**
macOS 15.7.9 x86_64 / Node 24.18.1, a plain `npm i @gjsify/node-gi @gjsify/webkit-native`
tree, GTK from Homebrew, no gtk-runtime bundle, `node probe.mjs` with `GI_TYPELIB_PATH`
and every `DYLD_*` unset:

| node-gi | result |
|---|---|
| 0.45.0 as published (no `native-prebuilds.js`) | `Typelib file for namespace 'WebKit', version '6.0' not found` |
| with this module | `LoadEvent.FINISHED`, DOM read back through `evaluate_javascript`, 5/5 runs exit 0 |

**And the discriminator that makes it a proof rather than a coincidence:** the staged
directory appears on NO loader variable in the running process. node-gi's own darwin
re-exec does set `DYLD_FALLBACK_LIBRARY_PATH` — for the HOST's GTK libdir, which is a
separate repair — so a probe that read the environment after the import would have
credited that variable. It composes to `/usr/local/lib:$HOME/lib:/lib:/usr/lib` and names
the prebuild directory nowhere; the only thing that put it in front of GI is
`prependSearchPath` + `prependLibraryPath`.

### The launcher stays

`gjsify run <bundle>` executes a USER bundle whose prebuilds come from the consumer's own
tree, and it is still right for that: the env is inherited by children, and a bundle is not
our code to instrument. This ADR removes the launcher as a **precondition for the CLI's own
engines**, nothing more.

### What it deletes

Per `docs/governance.md` § `simplicity`, the half that has to be argued:

- **the third branch of `diagnoseNativeEngine()`** — ~15 lines that existed to say "the
  launcher was bypassed, set these two variables". A bypassed launcher is no longer a cause
  of failure, so the branch does not get rewritten with better wording; it goes, and the
  remaining diagnosis is the honest one it was crowding out: no prebuild for this
  architecture.
- **the class of bug** "works through the launcher, fails when invoked directly" — which is
  not a bug anyone fixed, it is one that was worked around each time it was met (most
  recently by retargeting an e2e assertion from `gjsify build` to `gjsify copy` so it would
  stop tripping over an unrelated failure).
- **the e2e constraint** that `runGjs`-style suites must avoid dispatching an inner
  `gjsify build`.

## Consequences

- `gjs -m packages/infra/cli/dist/cli.gjs.mjs build …` works with an empty environment.
  Pinned by `tests/e2e/launcher-free-build/`, which scrubs both variables from the child
  env — a suite that would have passed vacuously before the change and fails without it.
- A consumer embedding the CLI's lib/ in their own GJS process no longer has to reproduce
  the launcher's environment.
- First `gjsify build` / `gjsify format` under GJS pays one `detectNativePackages()` sweep
  (~65 ms on this 960-workspace tree, less everywhere else) it did not pay before. Not
  conditioned on "did the launcher already do this": that check can be wrong, and a guard
  watching another mechanism is the shape § `simplicity` warns about.

### What this does NOT solve

Stated explicitly, because each is easy to assume from the headline:

- **`LD_LIBRARY_PATH` is still immutable in-process.** A prebuild whose library is found
  *only* by the system loader — not named by a typelib girepository is resolving — is
  unaffected. That is why the launcher is not deleted.
- **Only the CLI's own process is fixed.** `gjsify run <bundle>` still hands prebuilds to a
  child through the environment. A user bundle that imports `gi://Gjsify…` directly under a
  bare `gjs -m` still needs the launcher, or its own `prepend_*` call.
- **Windows is still unproven.** The API is platform-independent and
  `detectNativePackages()` already resolves per host. macOS/Node is now measured
  (§ The Node host); the GJS-side helper's measurements remain linux-x64, and nothing
  here exercises win32.
- **Not a system-library fix.** A missing `libjson-glib-1.0.so.0` fails exactly as before,
  and the diagnostic branch that measures it (#994, ts-for-gir#437) is untouched.
- **GLib < 2.86 gains nothing** — `dup_default()` is the process-global accessor and there
  is no substitute for it in the girepository-2.0 API.

## Implementation

1. `packages/infra/cli/src/utils/gi-search-path.ts` — `activateNativePrebuilds()`.
2. `bundler-pick.ts`: call it in `tryLoadNative()`; drop `diagnoseNativeEngine()` branch 3
   and the now-unused `libraryPathVar` import.
3. `utils/oxc-resolve.ts`: call it in `tryLoadNativeOxfmt()`.
4. `tests/e2e/launcher-free-build/run.mjs` (+ the `test:e2e` script entry — the shard runner
   parses that list rather than globbing).
5. `packages/infra/cli/AGENTS.md`: the launcher paragraph says what the launcher is still
   for instead of what it is required for.
