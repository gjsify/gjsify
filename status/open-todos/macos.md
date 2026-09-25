<!-- Authored Open-TODO sections — area: macOS / darwin.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### macOS fonts: what a Mac WITHOUT Homebrew resolves is still unmeasured

`add_font_file` is a vfunc the CoreText map does not implement, so on macOS every face used to
answer `G_IO_ERROR_NOT_SUPPORTED`. Two of the three processes that hit that are closed:

- **The bundled windowing runtime** selects `PANGOCAIRO_BACKEND=fc` (ADR 0038 § Amendment 3), so
  `initFonts()` registers both the runtime's Adwaita faces and the application's.
- **`gjsify run` on a Homebrew GTK** — no `.app`, so no `ATSApplicationFontsPath` — now falls back:
  `initFonts()` builds a fontconfig map, registers the declined faces there and makes it the
  default, only when fontconfig is configured, `PANGOCAIRO_BACKEND` is unset and the family is not
  already on the CoreText map (ADR 0038 § Amendment 5). Measured on macOS 27 arm64: `Round9x13`
  goes from `absent` to `exact`, `fonts.spec.ts` runs its discriminator suite as plain assertions.

**Still open.** Both routes put the font supply behind fontconfig, and the darwin bundle ships no
`etc/fonts` (§ Amendment 4, *What this control does NOT prove*). Every Mac measured so far had
Homebrew's `fonts.conf`; `font-script-coverage.test.mjs` simulates the no-Homebrew case, and until
someone runs a shipped `.app` on a clean Mac, this line stays. A shipped `.app` on a CoreText map
relies on `ATSApplicationFontsPath` alone; no leg here launches one, so that activation is Apple's
documented behaviour rather than a measurement.

**Also open:** `@gjsify/dom-elements`' `FontFace.load()` calls `add_font_file` on the default map
itself and swallows the error, so a Canvas `FontFace` on a CoreText map (e.g.
`excalibur-jelly-jumper` under `gjsify run` on macOS) still falls back to the default sans unless
`initFonts()` ran first and adopted the fc map. The fix is to route it through the same fallback
without making `dom-elements` depend on `@gjsify/gtk-host`.


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

**Still open here**, in the order they gate each other:

1. Make the prologue precede the static imports. Every shape found so far changes
   how a `--app gjs` bundle acquires GI namespaces (a second emitted file imported
   first, or lowering the externals to `globalThis.imports.gi.Ns` accessors in the
   body), which also moves the ground under `ship/gi-namespaces.ts` — it reads the
   `gi://` specifiers off the emitted bundle to compute package dependencies. ADR
   first, per § Governance.
2. A darwin end-to-end run: the PREPEND is macOS-measured (the table above) and the
   wiring is measured on linux — against a stand-in host for the darwin side, since
   this workspace has no Mac in it — but no Mac has yet run a bundle carrying it.
   That covers the host marker too: its absence is what a Linux run measures.
3. The link-closure half below, which no prologue can reach.


### The darwin loader repair still leans on an env variable outside GI's reach

`activateGiLibraryPath()` now tells GI itself where a typelib's bare-leaf backer lives, which is what makes bun and deno work on macOS at all. It cannot cover everything: a dylib pulled in by ANOTHER dylib's own link closure never passes through GI, so `maybeReexecForGtkRuntime()` (Node) and the launcher preamble (`bin-shim.ts`, every runtime) stay as the belt for that class.

Two consequences worth closing later, neither blocking: the Node re-exec is now redundant for everything GI resolves and could be narrowed to the closure case once a darwin CI leg proves it; and `hostGtkIsWorthTrying()` on an Apple-silicon host still answers from `systemGiLibraryDirs()`, whose `/opt/homebrew/lib` probe was never in dyld's default fallback — measured only on x86_64 so far.


### `os.cpus().times` on darwin needs a Mach call GJS cannot make

`@gjsify/os`'s darwin reader reports the documented all-zero `times` — every field present and numeric, none of them meaningful — and `package.json#gjsify.os.darwin` is `"partial"` with that as its printed reason. Linux reads the per-CPU tick counters from `/proc/stat`. The macOS equivalent is Mach's `host_processor_info(PROCESSOR_CPU_LOAD_INFO)`, the same call libuv makes, and it is unreachable from GJS without a native bridge; no userland tool prints the cumulative per-core totals Node returns (`top -l 1` and `iostat` give an INSTANTANEOUS aggregate percentage, which is a different quantity — deriving one from the other would be fabrication, not degradation). Closing it means a native bridge, so it is a scope decision rather than a task. `src/index.spec.ts` carries `it.failing('cpu times should have non-zero values', …, { when: isDarwin() && gjs })`, which runs the assertion and fails the day a reader exists — so this entry retires itself rather than needing to be remembered.


### A loopback teardown race survives on darwin, on the native-Node leg only

`@gjsify/net`'s `server.spec.ts` still reports 1-2 of 381 failing under NATIVE Node on darwin (`read ECONNRESET`), against 381 green under GJS on the same host. It was 2-4 before `withServer` took ownership of the accepted sockets and the affected specs learned to tolerate exactly `ECONNRESET`, so what is left is narrower, not closed. The mechanism is the kernel's: BSD resets a connection that is closed while unread data is buffered where Linux delivers a FIN, and an `'error'` event with no listener is re-thrown. The remaining failures wander between `close event after end` and `localPort after connect`, which is the signature of a socket outliving the spec that made it — the next thing to try is owning the CLIENT sockets' lifecycle the way the server's now is. Per this repo's testing rules a native-Node failure is a statement about the TEST, and our implementation is the one that is green.


### Two packages have no darwin target at all, and their specs say so by failing

`@gjsify/webrtc` dies at `Requiring GjsifyWebrtc … Typelib file for namespace 'GjsifyWebrtc' not found` and `@gjsify/sab-native`'s positive control `hasNativeSab() returns true when prebuild is loaded` cannot pass, because no `webrtc-native-darwin-*` package exists and `@gjsify/sab-native`'s `gjsify.platforms` declares `linux-*` only. Both are honest failures of a promise nobody made — the declarations are correct and the artifacts genuinely do not exist. Recorded so a macOS run's red is READ correctly: it is a missing target, not a broken port. Closing either means adding the darwin legs to `prebuilds.yml` and the targets to the manifests, at which point the same specs become the check. The sibling bridges (`http2-native`, `tls-native`, `terminal-native`, `http-soup-bridge`, `webgl`, `lightningcss-native`, `oxfmt-native`, `rolldown-native`) all already ship `*-darwin-{x64,arm64}`, so the pattern is proven — these two were simply never extended.

### `@gjsify/webkit-native` — what the darwin WebKit backend still owes

ADR 0022 landed the backend and `@gjsify/iframe`'s 291 tests pass on darwin. **Input forwarding, named script worlds and user-script allow/block lists have since landed too**, and the two entries that stood here for the latter pair were not deferrals but MISTAKES OF FACT — the ADR asserted "WKWebView has no public isolated-world API" when `WKContentWorld` has been public since macOS 11, and it warned-and-ran a script whose allow/block list said not to. Both are worth remembering as a shape: an Apple API that looks absent deserves a check of its availability annotation before a design is built around its absence. What remains:

**The namespace is squatted, and one host shape gets it wrong.** The shim's typelib IS `WebKit-6.0` (ADR 0022 decision 3, with the measurement that forced it). On a macOS host that built WebKitGTK 6.0 from source, two providers would compete on `GI_TYPELIB_PATH` and ours — a subset — could shadow the real one, where a missing class reads as `undefined` rather than as an error. Bounded today by the artifact shipping only in an `os: ["darwin"]` package and by macOS having no packaged provider; if that ever changes, the fix is a synchronous backend selector in `@gjsify/iframe`, which GJS does not currently offer in a form this repo permits.

**Three things the input work reached the end of the public API on, all measured rather than assumed** (`docs/poc/webkit-input-darwin.m` prints each): `document.hasFocus()` is permanently `false`, so `window.onfocus`/`onblur` never fire and no caret blinks — it is derived from a responder chain the windowless view has no place in, and an offscreen `NSWindow` was built and does NOT fix it. The pointer cursor never changes over links, for the same reason. And App Sandbox stays unanswered: `webkit-hardened-runtime-darwin.sh` shows the hardened runtime working with `com.apple.security.cs.allow-jit`, while the sandbox case dies at process start because `com.apple.security.app-sandbox` needs a bundled app with an `application-identifier` an ad-hoc signature cannot issue. Answering it needs a real Developer ID, not more code.

**The input path has no CI coverage on any platform, and that is the honest state.** It is held by two by-hand probes — `webkit-input-darwin.m` (NSEvent → WebKit → page) and `webkit-input-widget-darwin.m` (the widget's own controllers → page, driven by emitting the controller signals). Both need a display, which is the same wall as the DISPLAY-gated-GTK entry above, and `@gjsify/iframe`'s 291 unit tests instantiate no live WebView at all. Two routes into GTK's real event translation were tried and are dead ends worth not re-trying: `-[NSApplication postEvent:atStart:]` is never picked up (GTK4's macOS backend does not drain the posted-event queue — measured with a plain `GtkGestureClick` and no WebKit anywhere, 0 hits), and `CGEventPostToPid()` is dropped because `AXIsProcessTrusted()` is false and Accessibility is not a permission CI can grant itself.


### Nothing exercises the NODE-FREE toolchain on macOS, and the prebuild's arrival hid that

The engine half is DONE — `@gjsify/rolldown-native` declares all four of `linux-x64`, `linux-arm64`, `darwin-arm64`, `darwin-x64`; `packages/infra/rolldown-native-darwin-{arm64,x64}` hold committed artifacts; `--platforms` marks every darwin cell `✓` for it and for `@gjsify/lightningcss-native` / `@gjsify/oxfmt-native`; all three are on npm at the train version.

What no leg covers is the path those engines exist FOR. Both darwin jobs in `macos-suites.yml` install, bootstrap and build by invoking the CLI **under Node** (`node "$RUNNER_TEMP/bootstrap-cli/…/lib/index.js"`, then `node packages/infra/cli/lib/index.js run build`) — correct for proving the Node pillar on darwin, and blind to `gjs -m install.mjs` → `gjsify build` on a box with no Node at all. `tests/e2e/node-free-bootstrap` exercises that shape only on the Linux runner.

This entry previously read "no native macOS build has been promoted … until that leg is green the docs must keep describing the Node-free toolchain as Linux-only". The build was promoted; the instruction outlived it, and three pages of the website went on telling macOS users to install Node because a ledger entry told them to. **The lesson is the shape of the sentence**: a ledger item that instructs the DOCS to keep saying something has no retirement trigger — the docs do not fail when the code changes underneath them. State the condition to measure, not the prose to keep.

The work: a darwin leg whose install+build steps go through the bootstrap the way the Linux node-free leg does, with `node` off PATH for the duration so the leg cannot pass by accident.

