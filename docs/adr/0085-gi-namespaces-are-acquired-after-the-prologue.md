# 85. A `--app gjs` bundle acquires its GI namespaces AFTER the prologue, by lowering the static `gi://` imports to awaited dynamic ones

- Status: **Proposed**
- Date: 2026-09-30
- Deciders: Pascal Garber
- Related: [ADR 0021](0021-launcher-free-prebuild-resolution.md) (the in-process repair this
  generalises), [ADR 0023 § 4](0023-gtk-source-precedence.md) (two GI stacks in one process,
  and what the link closure hides from GI),
  [ADR 0024 § 6](0024-ship-installable-artifacts.md) (`gi://` specifiers → typelib packages),
  `packages/infra/rolldown-plugin-gjsify/src/plugins/gi-runtime-paths.ts`,
  `packages/infra/cli/src/utils/{gi-runtime-paths,system-gi}.ts`,
  `packages/infra/cli/src/utils/ship/gi-namespaces.ts`,
  `status/open-todos/macos.md` § "A globally installed GJS launcher still cannot load a system
  GTK on macOS", `tests/e2e/gi-runtime-prologue`,
  [docs/poc/gi-prologue-import-order.md](../poc/gi-prologue-import-order.md)

## Context

On macOS a typelib names its backing library by BARE LEAF (`libgtk-4.1.dylib`), and no
environment variable reliably reaches the process that needs it: SIP strips an inherited
`DYLD_*` at the `/bin/sh` exec a launcher goes through, and dyld captures the variable at
process LAUNCH, so mutating it from JS does nothing. The one repair that works is the one the
process makes to girepository's own search paths from the inside — `prepend_search_path` +
`prepend_library_path`, ADR 0021's mechanism, which `--app gjs` now ships as a byte-1 prologue
in every bundle.

**The prologue reaches only half of what it was built for, and this ADR is about the other
half.** A banner is the entry chunk's BODY. ESM evaluates a module's imports before its body,
so every STATIC `import … from 'gi://Ns'` has already run its `dlopen` — and failed — before
byte 1 of the prologue executes. File order is not evaluation order, and the emitted bundle
shows both at once: in a `--app gjs` build of a two-line GTK program the prologue sits at byte
2415 and the `import … from "gi://Gtk?version=4.0"` at byte 3045, and the import still wins.

What the prologue therefore covers is what loads LATER — `await import('gi://Soup')` and the
other optional namespaces (`@gjsify/fetch`, `@gjsify/dom-elements`, `@gjsify/gamepad`, the
prebuilt `gi://Gjsify*` bridges). What it does not cover is a GTK application, whose `gi://Gtk`
is a static import. That is the shape the whole macOS track exists for.

### Measured on darwin-arm64 (this is new)

macOS 27 / Apple M4 / Homebrew `/opt/homebrew` / gjs 1.88.1 / GTK 4, every run under
`env -u DYLD_FALLBACK_LIBRARY_PATH -u DYLD_LIBRARY_PATH -u GI_TYPELIB_PATH` (deleted, not
merely unset — this host's `~/.zshenv` exports the fallback path, and inheriting it makes every
row pass and measures nothing).

| Program | Result |
|---|---|
| `--app gjs` bundle, prologue + `await import('gi://Gtk?version=4.0')` | **loads** — `GtkWidget`, exit 0; search path `/opt/homebrew/lib` first |
| same program, NO prologue (plain `gjs -m`) | fails — `Failed to load shared library 'libgtk-4.1.dylib'`, dlopen tried gjs's rpath into **glib's keg alone** |
| `--app gjs` bundle, prologue + `import Gtk from 'gi://Gtk?version=4.0'` | **fails, identically** — the gap this ADR closes |

The host-marker path fires: `/System/Library/CoreServices/SystemVersion.plist` exists, so
`/opt/homebrew/lib` (the one probed candidate holding a `girepository-1.0/`) is prepended, and
`/usr/local/lib` + `/opt/local/lib` are not — the marker gate is non-vacuous in both directions
on this host. `systemGiLibraryDirs()` answers `["/opt/homebrew/lib"]` and
`hostGtkIsWorthTrying()` answers `true` on arm64, unchanged when `pkg-config` is removed from
`PATH`: the `PROBED_GI_LIBDIRS` table already carries the Apple-silicon prefix and does not
depend on the pkg-config source.

### Where a prologue MAY go, measured

Eleven placements, every one a child `gjs` with the loader variables deleted:
[docs/poc/gi-prologue-import-order.md](../poc/gi-prologue-import-order.md), harness
`docs/poc/gi-prologue-import-order.gjs.mjs`, which imports the REAL generator rather than a
retyped copy.

| Placement | Namespace loads |
|---|---|
| no prologue (control) | no |
| banner, then `await import('gi://Gtk')` | **yes** — what ships today |
| banner, then `import Gtk from 'gi://Gtk'` | no |
| prologue as its own MODULE, imported first | **yes** |
| the same module imported last | no |
| prologue module first, `gi://` import one module DEEPER | **yes** |
| `globalThis.imports.gi.Gtk` after the prologue | **yes** |
| `resource:///org/gnome/gjs/modules/esm/gi.js`'s `require()` after the prologue | **yes** |

The constraint is therefore narrower than "imports run first": GJS loads a namespace when
`gi://Ns` is EVALUATED, not when the graph is instantiated. Anything evaluated ahead of it can
still repair the loader — including a module one hop up the graph from where the import
actually sits, which is where most of them are (`@gjsify/gtk-host` imports Gtk, the app imports
that).

### What moves under `ship/gi-namespaces.ts`

`scanGiNamespaces()` parses the EMITTED bundle for `gi://` specifiers and maps them to typelib
packages (ADR 0024 § 6); a wrong answer there ships a `.deb` that installs cleanly and dies at
its first GI call, which is the defect that file's header already records once. Measured
against the real scanner:

| Emitted shape | `scanGiNamespaces()` |
|---|---|
| `import Gtk from 'gi://Gtk?version=4.0'` | `["Gtk-4.0"]` |
| `await import('gi://Gtk?version=4.0')` | `["Gtk-4.0"]` |
| `globalThis.imports.gi.Gtk` | **`[]`** |
| `gi.require('Gtk','4.0')` off the GJS resource module | **`[]`** |

`importedSpecifier()` already accepts `ImportExpression`, so the dynamic form needs no scanner
change; the two accessor forms erase the dependency set silently.

## Decision

**A `--app gjs` bundle's static `gi://` externals are LOWERED, in the entry chunk, to top-level
`await import()` calls placed immediately after the prologue.** The bundle keeps one file, one
prologue and its `gi://` specifiers.

1. **The lowering is the emitter's, not the source's.** Application and package sources keep
   writing `import Gtk from 'gi://Gtk?version=4.0'` — the typed, portable spelling that
   `@girs/*`, the node target's `requireGi` rewrite and the `--gi-renderer` arms all already
   key off. Nothing about the authoring contract changes.

2. **It happens where the banner already happens** — `renderChunk(order:'post')`, the hook that
   owns byte 1 of a `--app gjs` chunk today. The hoisted `gi://` chunk imports are replaced by
   bindings initialised from `await import(<the same specifier>)` emitted directly after the
   prologue, ahead of every bundled module body. The single-file invariant
   (`output.inlineDynamicImports: true`, one artifact per `--app` build) is preserved.

3. **The specifier survives verbatim.** That is what keeps `ship/gi-namespaces.ts`,
   `depends.ts` and the `--gi-renderer` refusals reading the artifact they already read, and it
   is the property that decides between this shape and both accessor lowerings.

4. **`--app node` is untouched.** There `gjsGiNodePlugin` already rewrites every `gi://`
   specifier into `requireGi("Ns","V")` before this question arises, and node-gi does its own
   in-process repair (ADR 0021). Measured: both a static and a dynamic `gi://` source produce
   the same `["Gtk-4.0"]` answer from the scanner through the `requireGi` form.

5. **The cost is a top-level await in every bundle that had a static `gi://` import, and it is
   named rather than discovered.** A module that has awaited is a PROMISE JOB. A BLOCKING
   `GLib.MainLoop.run()` entered from one parks the job queue: the source callback fires, the
   continuation it schedules is queued behind the still-running job, and a `loop.quit()` inside
   that continuation never arrives. Measured both ways — the identical program without the
   await exits, with it wedges. This is NOT the ADR-less TLA claim `docs/poc/tla-microtask-
   draining.md` refuted (microtasks do drain under a pending top-level await); it is the
   narrower re-entrancy fact, and the harness pins it as an expected `stalls` row.

6. **That cost falls on a shape the repo already forbids.** A GTK application runs via
   `await Application.runAsync()`, never the synchronous `run()` — root AGENTS.md § GLib
   MainLoop, and the reason `runAdwaitaApp` exists. Measured: the same lowered program using
   `runAsync` drains its source callback's continuation and quits normally. The implementation
   PR owes a check that makes the forbidden shape fail loudly rather than hang, and an e2e row
   for the `runAsync` path; it does not owe a way to keep a blocking `run()` working.

## Consequences

- A GTK application built with `--app gjs` loads a Homebrew/MacPorts GTK on a Mac with no
  launcher, no `DYLD_*` and no `GI_TYPELIB_PATH` — the thing the whole prologue was for.
- Every `--app gjs` bundle with a GI import becomes an async module. Anything importing such a
  bundle (the nested plugin build, `--library` consumers of a built artifact) awaits it, which
  ESM does anyway; a `gjs -m` entry does not care.
- The emitted bytes change for every bundle carrying a static `gi://` import, so
  `scripts/verify-committed-bundles.mjs` re-baselines once. Determinism is unaffected: the
  lowering is a function of the chunk's own external list, in the list's existing order.
- Startup gains one microtask turn per namespace. No new `stat`, no new file, no new process.
- The link-closure half stays out of reach, unchanged: a dylib pulled in by ANOTHER dylib's
  `LC_LOAD_DYLIB` never passes through GI, so `maybeReexecForGtkRuntime()` and the launcher
  preamble remain the belt for that class (ADR 0023 § 4, #1144).
- `gjsify.headless`'s root-import-graph walk reads SOURCE, not the emitted chunk, so a lowered
  import is still a declared reach. Nothing to change; stated because the check's subject
  looks like the thing being rewritten.

## Alternatives considered

- **A second emitted file, imported first.** Measured working, including when the `gi://`
  import sits a module deeper. Rejected on the artifact contract: `--app gjs|node|browser`
  produces ONE bundle file, and that invariant is load-bearing well outside the bundler —
  `gjsify ship`, the install formats, `gjsify install -g`'s launcher, `dist/affected.gjs.mjs`'s
  byte-for-byte rebuild and every consumer that copies "the bundle" all assume a single
  artifact. A repair for one platform's loader is not worth making every `--app gjs` output a
  directory, and a bundle that silently stops working when its sidecar is left behind is a
  worse failure than the one being fixed.

- **Lowering the externals to `globalThis.imports.gi.Ns` accessors.** Measured working, and
  rejected twice over. It erases the dependency set: `scanGiNamespaces()` answers `[]`, so
  `depends.ts` derives no typelib packages and ships the ADR 0024 § 6 defect a third time,
  after the regex version and the `--app node` version — a build-time guard could restore the
  list, but a guard watching a mechanism this ADR chose to break is the governance smell. And
  it puts the legacy host object in the emitted artifact, which root AGENTS.md bans AS AN API
  and `no-restricted-globals` holds at `error`. The version pin has no portable spelling there
  either — `imports.gi.versions.Ns = '4.0'` is process-global mutable state, where
  `gi://Ns?version=4.0` is per-import and is what the `--gi-renderer` arm's version refusal
  reads.

- **GJS's own ESM gi loader by resource path** (`import gi from
  'resource:///org/gnome/gjs/modules/esm/gi.js'; gi.require('Gtk','4.0')`). Measured working,
  synchronous, and free of `imports.*` — the strongest of the rejected shapes, and it would
  avoid clause 5's cost entirely. Rejected because it is a GJS INTERNAL resource URL with no
  stability contract: it is the implementation behind `gi://`, not a published interface, and
  pinning every shipped bundle to it makes a GJS refactor a field breakage in artifacts already
  installed. It erases the dependency set exactly like the accessor form, for the same reason.

- **Emit the prologue as a `data:` module imported first.** Would keep one file and precede
  every static import. Not available: GJS rejects the scheme outright —
  `Unsupported URI scheme for importing: data`.

- **Leave it, and document that a macOS GTK app needs `gjsify run`.** This is the status quo,
  and it is what ADR 0021 already decided against for prebuilds: a launcher that must be in the
  loop is the thing being removed, and an installed `.app` has no launcher in it.

## Implementation

Not in this PR — governance requires the ADR first, and this one is `Proposed`. The
implementing PR owes, in one change:

1. the lowering in `renderChunk`, beside the existing banner composition;
2. an e2e row in `tests/e2e/gi-runtime-prologue` that builds a STATIC-import GTK fixture and
   runs it under deleted loader variables, red today and green after — plus the `runAsync` row
   from clause 6;
3. a check for clause 5's forbidden shape, failing loudly rather than hanging;
4. the `verify-committed-bundles` re-baseline, and the AGENTS.md updates this ADR's decision
   makes due in `packages/infra/rolldown-plugin-gjsify/AGENTS.md`.

`docs/poc/gi-prologue-import-order.gjs.mjs` is the acceptance harness for clauses 1–6 and runs
on any host with a GI stack; it exits non-zero the day one of these facts stops holding.
