<!-- Authored Open-TODO sections — area: macOS / darwin.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### macOS fonts: what a Mac WITHOUT Homebrew resolves is still unmeasured

`add_font_file` is a vfunc the CoreText map does not implement, so on macOS every face used to
answer `G_IO_ERROR_NOT_SUPPORTED`. All three processes that hit that are closed:

- **The bundled windowing runtime** selects `PANGOCAIRO_BACKEND=fc` (ADR 0038 § Amendment 3), so
  `initFonts()` registers both the runtime's Adwaita faces and the application's.
- **`gjsify run` on a Homebrew GTK** — no `.app`, so no `ATSApplicationFontsPath` — now falls back:
  `initFonts()` builds a fontconfig map, registers the declined faces there and makes it the
  default, only when fontconfig is configured, `PANGOCAIRO_BACKEND` is unset and the family is not
  already on the CoreText map (ADR 0038 § Amendment 5). Measured on macOS 27 arm64: `Round9x13`
  goes from `absent` to `exact`, `fonts.spec.ts` runs its discriminator suite as plain assertions.
- **A Canvas `FontFace`** does not go through `initFonts()` at all — it is a page registering a face
  at runtime — so it carried the same decline in its own body and swallowed it, which is how
  `excalibur-jelly-jumper` under `gjsify run` rendered its text in the fallback sans unless
  `initFonts()` had happened to run first. `FontFace.load()` now calls the same
  `registerFontFaces()` out of **`@gjsify/utils/font-map`** — the lowest package `@gjsify/dom-elements`
  (tier 1) and `@gjsify/gtk-host` (tier 3) may both depend on, so the fallback has ONE owner and the
  two do not drift. Measured on macOS 27 arm64 by `dom-elements`' `font-face.spec.ts`: the family
  goes from `absent` to present, and a 40pt "Wg" stops measuring what an invented family measures.

**Still open.** All three routes put the font supply behind fontconfig, and the darwin bundle ships no
`etc/fonts` (§ Amendment 4, *What this control does NOT prove*). Every Mac measured so far had
Homebrew's `fonts.conf`; `font-script-coverage.test.mjs` simulates the no-Homebrew case, and until
someone runs a shipped `.app` on a clean Mac, this line stays. A shipped `.app` on a CoreText map
relies on `ATSApplicationFontsPath` alone; no leg here launches one, so that activation is Apple's
documented behaviour rather than a measurement.


### A globally installed GJS launcher still cannot load a system GTK on macOS

`buildNativeEnv()` repairs the loader path for everything that runs THROUGH the
CLI (`gjsify run`, `showcase`, `storybook`, `tsc`, `info`). A launcher written by
`gjsify install -g` for a package whose `gjsify.bin` is itself a GTK app `exec`s
the bundle directly, with no CLI in the loop, and therefore still hits the
bare-leaf `dlopen` on macOS.

**The mechanism is measured, not assumed** — and it is a finer point than
`buildNativeEnvPreamble`'s existing MACOS CAVEAT implies. SIP strips an INHERITED
`DYLD_*` at the `/bin/sh` exec (confirmed again:
`DYLD_FALLBACK_LIBRARY_PATH=/usr/local/lib /bin/sh -c 'echo $DYLD_FALLBACK_LIBRARY_PATH'`
prints nothing), but a value the preamble exports ITSELF survives the following
`exec gjs`, because Homebrew's `gjs` is unprotected: a hand-written `/bin/sh`
script whose body is `DYLD_FALLBACK_LIBRARY_PATH=/usr/local/lib:/usr/lib; export
DYLD_FALLBACK_LIBRARY_PATH; exec gjs -c '…imports.gi.Gtk; Gtk.init(); print("GTK
OK")'` prints `GTK OK` on the macOS 15.7.8 VM when invoked under
`env -u DYLD_FALLBACK_LIBRARY_PATH -u DYLD_LIBRARY_PATH -u GI_TYPELIB_PATH`.

So the preamble COULD carry it, and was deliberately left alone anyway, because
neither available shape is right: baking `systemGiLibraryDirs()` in at write time
reintroduces exactly the snapshot that function exists to remove (a launcher is
routinely written before `brew install gtk4`), and re-deriving it in shell is a
third copy of a two-copy rule — expressible for only one of its three sources, in
the one language nothing here type-checks. The right fix is to make such a
launcher defer to the CLI rather than re-derive; that is a launcher-shape change
and belongs in its own PR, ideally the one that lifts `system-gi` to a shared
package (above).

**A THIRD SHAPE EXISTS, and it needs no launcher at all — measured 2026-08-13 on
the macOS 15.7.9 x86_64 VM.** Neither of the two shapes above is the only option,
because the repair does not have to reach the process from OUTSIDE. GI takes it at
runtime, from inside the process, in three lines:

```js
const repo = imports.gi.GIRepository.Repository.dup_default();
repo.prepend_search_path(dir);   // replaces GI_TYPELIB_PATH
repo.prepend_library_path(dir);  // replaces DYLD_/LD_LIBRARY_PATH
```

Measured, plain `gjs`, under `env -u DYLD_FALLBACK_LIBRARY_PATH -u
DYLD_LIBRARY_PATH -u GI_TYPELIB_PATH`:

| | |
|---|---|
| no prepend | `Failed to load shared library 'libgtk-4.1.dylib'` — dlopen tried only gjs's own rpath, `…/Cellar/gjs/1.88.1/bin/../../../../opt/glib/lib`, i.e. **glib's keg alone**, confirming the mechanism this entry describes |
| with prepend | **`OK gtype: GtkWidget`** |

`Repository.dup_default()`, `prepend_search_path` and `prepend_library_path` are
all present under gjs 1.88.1 (checked on darwin AND linux). The linux control that
isolates which call does what: prepending only the SEARCH path finds the typelib
and then fails with `Failed to load shared library 'libgwebgl.so' referenced by the
typelib`, so `prepend_library_path` is load-bearing and not redundant.

This is the same call `activateGiLibraryPath()` (#1132) makes in C for node-gi —
`dup_default()` is node-gi's `DupDefaultRepository()`. What is new is that a GJS
BUNDLE can make it too, which removes the launcher from this path entirely rather
than making it smarter.

**It has no snapshot problem** (it runs at app start, so `systemGiLibraryDirs()` is
evaluated then) and **no shell copy** (same TypeScript, type-checked). Both
objections above dissolve.

**What it does NOT cover, so the launcher does not disappear wholesale:** a library
pulled in through ANOTHER library's link closure (`LC_LOAD_DYLIB` / `NEEDED`). The
loader resolves those and GI never sees them, so only `@rpath`/`$ORIGIN` in the
binaries reaches them — the same distinction ADR 0023 § 4 draws, and the reason
#1144 is not fixed by this.

**The open decision is now MADE, and it came out the other way round.** It read:
the two app-relative sources (gjsify's own `prebuilds/<target>` dirs, a chosen GTK
bundle's `libDir`) "need nothing new", only the SYSTEM dirs are awkward because
`systemGiLibraryDirs()` lives in `@gjsify/node-gi`. Both halves were wrong.

The system dirs need no lifting at all: what a bundle can carry is not that
function's ANSWER — it measures the BUILD host, and answers `[]` on the Linux
runner that builds most releases — but the CANDIDATE table it probes, which
`@gjsify/cli` already mirrors (`utils/system-gi.ts`, held to node-gi's copy by an
output-comparing agreement suite). So the candidates travel and the probe moves
into the bundle, gated on TWO markers: each prefix's own `girepository-1.0`, and a
path that says the running host is darwin at all. The second one is not
belt-and-braces — the table is keyed BY PLATFORM and `systemGiLibraryDirs()` is
empty off darwin on purpose (ld.so's system-wide cache already resolves these
leaves), while `/usr/local/lib/girepository-1.0` is a perfectly normal Linux shape
(`meson setup --prefix=/usr/local`, jhbuild). A bundle cannot read
`process.platform`, so that scope has to travel as a marker path too; without it
every such Linux host would get `/usr/local/lib` prepended ahead of its distro
typelibs AND libraries, which is the two-stacks precedence ADR 0023 § 4 describes.
The marker is the plist `@gjsify/child_process`'s `detectPlatform()` already
probes, so the two cannot drift into two answers.

The app-relative dirs are the ones that do not work. Measured in this workspace,
`detectNativePackages()` answers with ten paths shaped
`../../../../node_modules/@gjsify/webgl-linux-x64/prebuilds/linux-x64` — the BUILD
host's target twice over (ADR 0017 gives every target its own package) at the BUILD
tree's depth, so on the macOS install this entry is about it names nothing, and
baking it would make `dist/affected.gjs.mjs` — a `--app gjs` bundle
`scripts/verify-committed-bundles.mjs` rebuilds and compares byte for byte — encode
which platform siblings the committing machine happened to have. They are left out;
`activateNativePrebuilds()` already handles them where the fact is true, inside the
running process.

**Landed:** the prologue ships in every `--app gjs` bundle, carrying the system
candidates only (`packages/infra/cli/src/utils/gi-runtime-paths.ts`, e2e
`gi-runtime-prologue`).

**And it reaches less than this entry assumed — measured, gjs 1.88.1, linux.** A
banner is the entry chunk's BODY, and ESM evaluates a module's imports before its
body, so every STATIC `import … from 'gi://Ns'` in a bundle has already loaded its
typelib — and failed or not — before byte 1 of the prologue runs. Pinned in
`tests/e2e/gi-runtime-prologue`: with the banner text FIRST and `import
'gi://NoSuchNamespace'` after it, the banner's `print` never appears. `data:` module
URLs, which would let one file still import a prologue ahead of them, are rejected
by GJS (`Unsupported URI scheme for importing: data`).

So the prologue covers what loads LATER — `await import('gi://…')`, the established
gjsify shape for exactly the optional namespaces this is about (`@gjsify/fetch`'s
Soup, `@gjsify/dom-elements`' PangoCairo, `@gjsify/gamepad`'s Manette, the prebuilt
`gi://Gjsify*` bridges) — and NOT a GTK app whose `gi://Gtk` is a static import.

**A Mac has now run a bundle carrying it — macOS 27, Apple M4 (darwin-arm64),
Homebrew `/opt/homebrew`, gjs 1.88.1, under `env -u DYLD_FALLBACK_LIBRARY_PATH -u
DYLD_LIBRARY_PATH -u GI_TYPELIB_PATH`.** A `--app gjs` bundle whose GI use is
`await import('gi://Gtk?version=4.0')` loads and prints `GtkWidget`, with
`/opt/homebrew/lib` first on the repository's search path; the same program without
the prologue fails on the bare-leaf dlopen. The host marker fires and is non-vacuous
in both directions: `/System/Library/CoreServices/SystemVersion.plist` exists, the
one probed candidate holding a `girepository-1.0/` is prepended, and `/usr/local/lib`
+ `/opt/local/lib` are not. So the e2e's stand-in host measured the right thing, and
the darwin leg of this entry is closed — what remains is the STATIC-import half,
which the same run confirms is still out of reach.

**Still open here**, in the order they gate each other:

1. Make the prologue precede the static imports. **Decided in
   [ADR 0085](../../docs/adr/0085-gi-namespaces-are-acquired-after-the-prologue.md)
   (Proposed, gating): lower the static `gi://` externals, in the entry chunk, to
   top-level `await import()` after the prologue** — one artifact, and the `gi://`
   specifier stays in it, which is what keeps `ship/gi-namespaces.ts` reading the
   file it already reads (measured: the accessor lowerings answer `[]` there, i.e.
   an empty typelib dependency set, the ADR 0024 § 6 defect a third time). The
   placement study behind it — eleven rows, including the `globalThis.imports.gi.Ns`
   and GJS-resource-loader alternatives, all three of which DO load — is
   `docs/poc/gi-prologue-import-order.{md,gjs.mjs}`. Implementation is owed, not
   done.
2. The link-closure half below, which no prologue can reach.


### The darwin loader repair still leans on an env variable outside GI's reach

`activateGiLibraryPath()` now tells GI itself where a typelib's bare-leaf backer lives, which is what makes bun and deno work on macOS at all. It cannot cover everything: a dylib pulled in by ANOTHER dylib's own link closure never passes through GI, so `maybeReexecForGtkRuntime()` (Node) and the launcher preamble (`bin-shim.ts`, every runtime) stay as the belt for that class.

One consequence worth closing later, not blocking: the Node re-exec is now redundant for everything GI resolves and could be narrowed to the closure case once a darwin CI leg proves it.

**The Apple-silicon half is measured and correct.** On macOS 27 / M4, `systemGiLibraryDirs()` answers `["/opt/homebrew/lib"]` and `hostGtkIsWorthTrying()` answers `true` — unchanged with `pkg-config` off `PATH` and `GI_TYPELIB_PATH`/`PKG_CONFIG_PATH` deleted, so the answer comes from the `PROBED_GI_LIBDIRS` table and not from the pkg-config source. That the prefix was never in dyld's default fallback is exactly why the probe is there, and it is what the arm64 run confirms: `/opt/homebrew/lib` is found, `/usr/local/lib` and `/opt/local/lib` hold no `girepository-1.0/` on this host and are correctly refused.


### `os.cpus().times` on darwin needs a Mach call GJS cannot make

`@gjsify/os`'s darwin reader reports the documented all-zero `times` — every field present and numeric, none of them meaningful — and `package.json#gjsify.os.darwin` is `"partial"` with that as its printed reason. Linux reads the per-CPU tick counters from `/proc/stat`. The macOS equivalent is Mach's `host_processor_info(PROCESSOR_CPU_LOAD_INFO)`, the same call libuv makes, and it is unreachable from GJS without a native bridge; no userland tool prints the cumulative per-core totals Node returns (`top -l 1` and `iostat` give an INSTANTANEOUS aggregate percentage, which is a different quantity — deriving one from the other would be fabrication, not degradation). Closing it means a native bridge, so it is a scope decision rather than a task. `src/index.spec.ts` carries `it.failing('cpu times should have non-zero values', …, { when: isDarwin() && gjs })`, which runs the assertion and fails the day a reader exists — so this entry retires itself rather than needing to be remembered.


### `@gjsify/webkit-native` — what the darwin WebKit backend still owes

ADR 0022 landed the backend and `@gjsify/iframe`'s 291 tests pass on darwin. **Input forwarding, named script worlds and user-script allow/block lists have since landed too**, and the two entries that stood here for the latter pair were not deferrals but MISTAKES OF FACT — the ADR asserted "WKWebView has no public isolated-world API" when `WKContentWorld` has been public since macOS 11, and it warned-and-ran a script whose allow/block list said not to. Both are worth remembering as a shape: an Apple API that looks absent deserves a check of its availability annotation before a design is built around its absence. What remains:

**The namespace is squatted, and one host shape gets it wrong.** The shim's typelib IS `WebKit-6.0` (ADR 0022 decision 3, with the measurement that forced it). On a macOS host that built WebKitGTK 6.0 from source, two providers would compete on `GI_TYPELIB_PATH` and ours — a subset — could shadow the real one, where a missing class reads as `undefined` rather than as an error. Bounded today by the artifact shipping only in an `os: ["darwin"]` package and by macOS having no packaged provider; if that ever changes, the fix is a synchronous backend selector in `@gjsify/iframe`, which GJS does not currently offer in a form this repo permits.

**Three things the input work reached the end of the public API on, all measured rather than assumed** (`docs/poc/webkit-input-darwin.m` prints each): `document.hasFocus()` is permanently `false`, so `window.onfocus`/`onblur` never fire and no caret blinks — it is derived from a responder chain the windowless view has no place in, and an offscreen `NSWindow` was built and does NOT fix it. The pointer cursor never changes over links, for the same reason. And App Sandbox stays unanswered: `webkit-hardened-runtime-darwin.sh` shows the hardened runtime working with `com.apple.security.cs.allow-jit`, while the sandbox case dies at process start because `com.apple.security.app-sandbox` needs a bundled app with an `application-identifier` an ad-hoc signature cannot issue. Answering it needs a real Developer ID, not more code.

**The input path has no CI coverage on any platform, and that is the honest state.** It is held by two by-hand probes — `webkit-input-darwin.m` (NSEvent → WebKit → page) and `webkit-input-widget-darwin.m` (the widget's own controllers → page, driven by emitting the controller signals). Both need a display, which is the same wall as the DISPLAY-gated-GTK entry above, and `@gjsify/iframe`'s 291 unit tests instantiate no live WebView at all. Two routes into GTK's real event translation were tried and are dead ends worth not re-trying: `-[NSApplication postEvent:atStart:]` is never picked up (GTK4's macOS backend does not drain the posted-event queue — measured with a plain `GtkGestureClick` and no WebKit anywhere, 0 hits), and `CGEventPostToPid()` is dropped because `AXIsProcessTrusted()` is false and Accessibility is not a permission CI can grant itself.


### No cold-tree `build:infra` without Node runs on macOS

The e2e half is DONE: `macos-suites.yml`'s node-pillar leg runs `node-free-bootstrap`, `workspace-node-free-gjs`, `launcher-free-build`, `node-script` and `tsc-node-fallback` on both darwin arches — install, orchestration, build, `--node-script` and the tsc fallback, each through `gjs -m dist/cli.gjs.mjs` with `node` resolving nowhere. Wiring them up is what found the defects nothing had seen (a bare `sysctl` that killed the CLI at module evaluation, `/proc`-only process-tree and liveness probes, SIP stripping the launcher's `DYLD_*` inside compound scripts); `docs/bundled-toolchains.md` § macOS has them and the manual recipe.

**The job is WIRED and the local arm64 measurement is RED, so this entry stays.** `macos-suites.yml`'s `node-free-cold-bootstrap` is the darwin answer to `main.yml`'s `cold-bootstrap`: its own cold checkout (`no node_modules`, `no lib/esm`, `no CLI bundle` — each asserted, never assumed), `brew install gjs json-glib`, every PATH entry holding a `node` dropped with a `gjs`-only symlink dir in its place, `command -v node` asserted to FAIL inside the job so it cannot pass vacuously, then `gjs -m install.mjs` → `gjsify install --immutable` → `gjsify run build:infra`. It runs on every event — the cost is a fixed per-run job on the macOS pool, which is what that pool is short of (slots, not billed minutes; `docs/ci-selective.md` § What is scarce), the same price `prebuilds.yml`'s `build-prebuilds-macos` pays; the Intel leg rides the same `ci:macos` label `main.yml` uses, so a PR without it runs arm64-only.

**Measured 2026-09-30 on a stock Mac (macOS 27 arm64, gjs 1.88.1, SIP ON, Homebrew `node@24` moved off PATH): the install is GREEN, `build:infra` is RED.** It got further than this entry expected and then died on the first `process.stdout.columns` read inside `build:infra`'s nested `gjsify workspace @gjsify/vite-plugin-blueprint build`, with the half-loadable-namespace symptom `docs/bundled-toolchains.md` § macOS already describes:

    Failed to load shared library 'libgjsifyterminal.dylib' referenced by the typelib
    JS ERROR: Error: Unsupported type void, deriving from fundamental void
    get columns@…/@gjsify/cli/dist/cli.gjs.mjs

**The cause is a RELEASE LAG, not a defect to fix here — measured, not inferred.** A cold tree has exactly one CLI (ADR 0002): the release bundle `install.mjs` fetches. That is v0.52.0, cut at `1304a6ed6` on 2026-09-24, and it PREDATES the very fix that makes this work — `0bdb54b18` ("fix: make the node-free toolchain work on macOS", #1797, 2026-09-26) added that repair two days later. It carries **no `get_typelib_path` at all** (0 occurrences against 3 `prepend_library_path`), `colocateNativeLibrary` being the repair in question — one that prepends a typelib's OWN directory to girepository's library path before the first class access. An isolated probe on this host doing exactly what that helper does resolves `GjsifyTerminal`, reads `get_typelib_path`, prepends its directory and loads `Terminal.get_size(1)` cleanly, so the repair is what closes this and it is on `main`. A nested `gjsify` is where it bites, and the launcher cannot rescue it: ESM evaluates a module's imports before its body, so `@gjsify/terminal-native`'s loader runs before `activateNativePrebuilds()`, and the launcher's `DYLD_LIBRARY_PATH` already names the directory the missing dylib sits in — it does survive on this host (measured: inherited → stripped; exported by the `/bin/sh` itself → present), which is exactly why the fix has to be in-process.

**The first CI run came back RED TOO, and earlier than the local one — the SIP-off prediction below did NOT hold.** Run 36763723877, both arches (`macos-15` 15.7.9 and `macos-latest`), 2026-09-30: the job dies in its FIRST step, `gjs -m install.mjs`, not at `build:infra` as the local measurement did, and on a different library:

    GLib-GIRepository-WARNING: Failed to load shared library 'libgjs.0.dylib' referenced by the typelib:
      dlopen(libgjs.0.dylib, 0x0009)
    Gjs-CRITICAL: JS ERROR: Error: Unsupported type void, deriving from fundamental void

`libgjs.0.dylib` is GJS's OWN library, reached as a bare leaf — the shape `docs/prebuilds.md` records as girepository reporting its LAST attempt rather than the one that would have worked. So the ledger entry as written (a release lag in the published bundle, expected green on a SIP-off runner) does not describe what CI measured, and neither does it describe the whole cause: whatever puts the GJS library directory on the loader's path is being lost on this job in a way the local run did not reproduce, and that is a fact about the JOB, not about the release. The two runs are not the same finding, so the earlier claim that a green CI run and a red local run would be "the two halves of one finding" is withdrawn — they are two failures at two different steps, and the CI one is the earlier and simpler.

**The open question is ANSWERED, and the cause was the JOB, not the release.** The node-pillar leg above carries a step this job lacked: `Make libgjs resolvable without a DYLD_ variable` — a symlink from `$prefix/opt/gjs/lib/libgjs.0.dylib` into `$prefix/opt/glib/lib/`, the one directory the `gjs` binary's rpath names. `GjsPrivate-1.0.typelib`, which Gio's core override loads from `_init`, records its library by bare leaf, so `gjs -m install.mjs` — which imports `Gio` in its first lines — died at the first typelib load on both arches. The local Mac had the repair (measured there on 2026-09-19, which is why the local run was green); a fresh `brew install gjs` on a runner does not create it. The step is in the job now, and the leg runs unconditionally — the cost is a fixed per-run job on a pool measured pinned at its cap, which is the price of the answer this job exists to give.

**The second CI run cleared that and died on the NEXT missing formula — again the JOB, not the release.** Run 36782997923, both arches: the symlink repair held (the job cleared the `Gio` import and the cold-tree assertions), and then `gjs -m install.mjs` died at MODULE LOAD: `Requiring Soup, version 3.0: Typelib file for namespace 'Soup', version '3.0' not found`. `install.mjs` calls its `loadSoup()` at module top level, so `gi://Soup?version=3.0` links BEFORE the first byte downloads; its DYLD re-exec repairs the dylib's bare-leaf dlopen but cannot help the TYPELIB, which girepository resolves through its own default paths. The node-pillar leg needs no libsoup — its CLI bundle is rebuilt from source and its node-free install runs against an empty lockfile (nothing to fetch). `brew install libsoup` puts both the typelib and the dylib where they are found; it is in the job now.

**The lesson this entry used to carry stands**: it once told the DOCS to keep describing the node-free toolchain as Linux-only, which outlived the promotion it was waiting for — a ledger item that instructs the docs has no retirement trigger. State the condition to measure, not the prose to keep. One copy of the old claim does remain, and it is NOT to be edited before a CI run is green: `website/src/content/docs/platform-support.mdx` says "What is missing is a CI job that drives `gjs -m install.mjs` all the way to `gjsify build` with no Node on the machine." Correcting it is this entry's last act, not this PR's.

