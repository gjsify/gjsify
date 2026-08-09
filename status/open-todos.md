<!-- Authored Open-TODO sections — THIS FILE is the tracked source of truth (the
     rendered STATUS.md view is generated and gitignored). One `### <title>` per open item.
     A RESOLVED item is DELETED (its record is the commit + CHANGELOG that closed
     it) — the status-data check rejects struck-through / ✓ / "Completed"
     headings, so the done-log cannot regrow. -->

### `@gjsify/sqlite` reads three value shapes back wrong

Found while adding the parameter-binding regression suite; all three are in the READ
path (`data-model-reader.ts` / libgda's data model), none of them in what gets bound, so
they were deliberately left out of the binding fix rather than bundled into it.

1. **An integral REAL past 2^53 throws instead of reading.** `convertValue()` treats any
   integral JS number over `Number.MAX_SAFE_INTEGER` as an out-of-range INTEGER and raises
   `OutOfRangeError`, but a SQLite REAL that happens to be integral — `1e21` — is not one.
   Telling them apart needs the column's storage class, which the reader never consults.
   Declared as `it.failing` in `param-binding.spec.ts`, so it retires itself when fixed.
   Node returns `1e21` here.

2. **A typeless column holding mixed types reads back as strings.** libgda types a data
   model column ONCE, so a column holding `'text'`, `42.0` and `NULL` comes back with the
   number as the string `"42.0"`. Node reads each value with its own storage class. The
   affected spec asserts `typeof(a)` per row instead, which is a homogeneous text column
   and therefore reads the same on both runtimes.

3. **`CAST(x AS TEXT)` yields an unconverted `Gda.Text` boxed value.** `convertValue()`
   has no branch for it, so it falls through and the caller gets `{}` instead of a string.

None of the three is reachable from `postbote`'s index today, which is why the binding fix
did not wait for them.

### `foreach build` can read a workspace package's `lib/` while another job is writing it

The parallel sweep rebuilds packages that the RUNNING CLI imports at runtime, so
a package's build can import a half-written `lib/esm`. Measured on the macOS
leg (run 31130155911, darwin-arm64), on the first full build that leg had ever
reached:

    [gjsify foreach] start @gjsify/native-platform (49/160 done, 3 in flight)
    [gjsify foreach] start @gjsify/npm-registry    (50/160 done, 3 in flight)
    [@gjsify/native-platform] ERR_MODULE_NOT_FOUND
      .../npm-registry/lib/esm/_virtual/_rolldown/runtime.js
      imported from .../npm-registry/lib/esm/auth.js

`auth.js` was already on disk and its rolldown chunk was not — a creation
window, not a corrupt build.

**Narrowed, not closed.** `build:infra` used to build `@gjsify/{semver,
npm-registry,tar,workspace}` with `build:types`, which writes `lib/types` and
NOT the `lib/esm` that their `exports["."].default` names — so the CLI's own
four runtime dependencies were still absent when the sweep began creating them.
They now get a full `build`, verified on a cold tree: all four have
`lib/esm/index.js` AND `lib/esm/_virtual/` before the sweep starts. That is the
same protection Linux CI gets for free from its restored `lib/` cache, which is
why a Linux pipeline never saw this — a cold Linux worktree at the same commit
built all 160 packages green, so the race is real but timing-dependent and
macOS simply lost it.

What is NOT fixed: a concurrent REWRITE of an existing `lib/` is still a window,
it is just a much smaller one (every file already exists). The structural fix is
for `foreach build` to build the CLI's own dependency closure serially before
starting the parallel sweep, rather than relying on `build:infra` having done
it. Do that where the scheduler lives, not in a root script.

### The macOS/Windows cold-tree bootstrap still needs a two-variable bridge in the workflow

`macos-suites.yml` and `windows-suites.yml` bootstrap from the PUBLISHED CLI,
because ADR 0002 untracked both bundles and a cold tree therefore has no CLI of
its own. After `install --immutable` the tree DOES have
`node_modules/.bin/gjsify`, and it dispatches to build outputs that
`build:infra` is what produces — so the first nested `gjsify` inside that
compound script dies with `Cannot find module …/packages/infra/cli/lib/index.js`.

Fixed at the core for the NEXT release: `ensureGjsifyShimOnPath()` now also
covers a bootstrap CLI under Node (not only the node-free GJS case), and
`detectPackageManager()` returns `gjsify` for it — the second half matters
because npm re-prepends `node_modules/.bin` for every lifecycle script it
starts, which puts the dead shim back one level down and undoes the first half.
Measured on a cold Linux worktree with the build cache cleared: `build:infra`
exits 0 with the fixed CLI and fails on its first clause without it.

Until that CLI is `latest` on npm the two legs set `GJSIFY_SHIM_DIR` and
`npm_config_user_agent=gjsify/bootstrap`, the two levers the published 0.30.0
already honours (`lib/commands/run.js` unshifts the first; `lib/commands/
workspace.js` reads the second). **RETIREMENT TRIGGER: delete both `env:` blocks
once `npm view @gjsify/cli version` is >0.30.0** — they are inert from that
point, not merely redundant, and leaving them hides whether the core fix works.

Linux never needed either lever: its bootstrap runs the published GJS bundle,
where `detectPackageManager()` already returns `gjsify`. That is also why a
Linux-only pipeline could not see this — the same shape ADR 0018 § 5 predicts.

### A Node-less host cannot bootstrap a fresh CLONE — five `node scripts/*.mjs` calls remain

Measured on a postmarketOS/aarch64 phone (musl, gjs 1.88.1, no node/npm/git) and
reproduced locally by removing the only `node` from `PATH`: on a fresh clone
`gjsify install` succeeds (982 packages, all 10 native prebuild packages
detected, `linux-arm64` selected) and `gjsify build` then fails with "no usable
bundler engine under GJS", because `@gjsify/rolldown-native`'s JS facade is a
build output a clone does not carry.

**CORRECTED 2026-08-06 — the conclusion below was wrong, and the two halves are
about different things.** What this entry established is still true: the
published `@gjsify/rolldown-native` TARBALL is fine (verified against 0.26.1: 27
files, `package/lib/esm/index.js` present), and inside a clone it is the
workspace symlink that shadows it. What it then CONCLUDED — "a consumer install
is NOT affected … a repo-development limitation, not a shipped defect" — is
false, and #1005 measured it from the outside (ts-for-gir run 31027844989): a
consumer install lays down no engine AT ALL, because `@gjsify/rolldown-native`
is an optional PEER dependency and the native install backend never resolves
peerDependencies. `installGjsEnginePackages()` is wired into `install -g` and
`self-update` only. So the tarball is sound and never arrives, and under GJS
there is no npm `rolldown` to degrade to. A sound artifact that no install path
delivers is still a shipped defect — see #1005, which owns that half.

`build:infra` no longer dies at its FIRST entry: the nine bare `tsc` calls now go
through `gjsify tsc` (byte-identical emit, verified per package against the npm
`tsc`), which carries the first five entries. It now dies at the sixth,
`@gjsify/create-app`, exit 127 on `node scripts/process-template.mjs`. Four
`node` invocations remain IN THAT CHAIN:
`create-gjsify/scripts/process-template.mjs` (151 LOC),
`create-gjsify/scripts/set-bin-mode.mjs` (35), `cli/scripts/build-assets.mjs`
(49) and `scripts/bootstrap-native-facades.mjs` itself. All four import only
`node:fs`/`node:path`/`node:url` — every one of which gjsify polyfills — so
nothing about them is intrinsically Node-bound; what is missing is a way to RUN
an unbundled `.mjs` that imports `node:*` under GJS, since GJS's ESM loader
cannot resolve those specifiers. Closing it means either bundling each to a
committed `dist/*.gjs.mjs` (more artifacts under the committed-bundle
freshness gate — the expensive option) or a `gjsify run --node-script <file>`
mode that bundles-and-runs on the fly (one mechanism, no new artifacts — the
better option, and it would serve every repo script, not just these).

The mechanism is less new than it reads: `BuildAction.bundleFileForGjsCached`
(`packages/infra/cli/src/actions/build.ts:513`) already bundles a single file for
GJS and is already called from two places. `--node-script` is CLI wiring on top
of it, not machinery to invent.

**A FIFTH call, and it is NOT equivalent to the other four (#1053).**
`packages/web/adwaita-web/scripts/build-scss.mjs` — reached from adwaita-web's
`check`, `build` and `build:test:browser`. The postmarketOS measurement never saw
it because that run stopped at `build:infra`, and this script sits outside that
chain; the enumeration above is of the bootstrap chain, not of the repo.

The distinction matters, because "port all five when `--node-script` lands" is
wrong. The other four needed no change at all. This one did: dart-sass gates its
four FILE-PATH entry points — `compile`, `compileAsync`, `render`, `renderSync` —
behind a runtime `isNodeJs()` test and throws "The compile() method is only
available in Node.js."; `compileString`/`compileStringAsync` carry no such test.
A `--app gjs` bundle omits the `node` export condition by design
(`packages/infra/rolldown-plugin-gjsify/src/app/gjs.ts:201`), so the script would
have built GREEN and thrown at the first compile. It is on `compileString` now
(byte-identical CSS and source map, verified against the previous output).

What is still open there is the FILE READS, and it is the same shape one level
down: `sass.node.js` populates the global `self.fs` that dart-sass reads every
file through (`fs: require("fs")` in its `library.load({…})`), while
`sass.default.js` loads with `{immutable}` only. On a non-Node runtime that
global is undefined, so sass can open nothing — neither its own filesystem
importer nor the `file:` URL a `FileImporter` hands back. Resolution is routed
through an explicit importer in the script for exactly that reason: finishing the
port is swapping that one object for an `Importer` whose `canonicalize`/`load`
supply CONTENTS through `node:fs`, with nothing else in the file changing.

**2026-08-06 — `--node-script` is viable, and the circularity has a documented
exit.** `scripts/bootstrap-native-facades.mjs` states the trap in its own header:
under GJS `gjsify build` needs the native engine, whose JS facade is itself a
build artifact, so building the facade needs a bundler. A bundle-and-run mode
therefore cannot bootstrap THAT script from a cold clone using the WORKSPACE CLI.

What breaks the cycle is where the engine is resolved from. The published
`@gjsify/rolldown-native` tarball carries a real `lib/esm/index.js`; only inside
a clone does the workspace symlink shadow it. And `installGjsEnginePackages()`
IS wired into `install -g` — so a gjsify installed the Node-less way
(`gjs -m install.mjs`, the path CI now uses too) has a working engine, while the
workspace CLI in a clone does not. So `gjsify run --node-script` works today when
driven by the GLOBAL CLI, which is exactly the host that needs it; inside a clone
the Node entry exists anyway. The residual gap is #1005 (a plain workspace
install lays down no engine because the peer is never resolved), not this.

Scope note when building it: it is ONE mechanism serving every script and every
consumer. Hand-porting these scripts to `gi://` instead is N pieces of work
AND makes each one Node-incompatible — motion without deletion (AGENTS.md
§ Governance, `simplicity`). The fifth script above shows the other half of the
same rule: it needed a real change, and that change was an API swap INSIDE the
script, not a `gi://` rewrite of it.

Until then the engine diagnostic says the limitation out loud rather than
recommending two commands that cannot work there; that wording is already fixed.

### Every DISPLAY-gated GTK test silently skips on macOS, so the darwin GTK path is near-uncovered

`test/gtk-smoke.test.mjs`, `gtk-template*.test.mjs`, `adw-smoke.test.mjs` and
`cairo-drawfunc.test.mjs` each gate on
`!!process.env.DISPLAY || !!process.env.WAYLAND_DISPLAY`. GTK's macOS backend is
quartz, which sets NEITHER — so on both macOS matrix legs every one of them
reports as a clean skip, and the `macos` job has never executed a GTK assertion.
That is how two independent darwin defects shipped in v0.27.0 together (the
bare-leaf `dlopen` and the ELF-soname-only template API): nothing on that job
could fail.

The new `test/gtk-typelib-backers.test.mjs` closes the part that needs no
display, which is the loader question and was the reported bug. What is still
uncovered is everything downstream of `gtk_init`: real windows, composite
templates, the Cairo draw func. **Measured, and it is the encouraging half:** on
the local macOS 15.7.8 test VM the fireworks showcase constructs a
`Gtk.ApplicationWindow` from a `.blp` template and runs its main loop cleanly
over a plain SSH session with no GUI login — so quartz needs far less than
`DISPLAY` implies, and the honest predicate is probably
`process.platform === 'darwin' || DISPLAY || WAYLAND_DISPLAY`.

Not changed here because the predicate is copy-pasted into five test files
(lift it to one shared helper in the same change — that duplication is the
reason it drifted this far) and because "a GitHub macOS runner has a usable
window server" is an assumption this PR has no way to measure; getting it wrong
turns five clean skips into five red legs on an unrelated PR. Do it as its own
change, where a red macOS leg means what it says.

### `systemGiLibraryDirs()` lives in two places, pinned by a test rather than shared

The darwin bare-leaf `dlopen` gap is one rule with THREE consumers now:
`@gjsify/node-gi` re-execs itself with the host's GI libdirs on
`DYLD_FALLBACK_LIBRARY_PATH`, `@gjsify/cli`'s `buildNativeEnv()` puts the same
dirs on the gjs CHILD's copy of that variable (Homebrew's `gjs` has an rpath into
GLIB's keg alone, so a plain `gjs -c "imports.gi.Gtk; Gtk.init()"` reproduced the
failure with no gjsify in the process — the trace is in
`packages/infra/cli/src/utils/system-gi.ts`), and — since ADR 0022's follow-up —
`prebuilds.yml`'s macOS **load-test step**, which had CLAIMED in a comment to
mirror `buildNativeEnv()` while carrying only the `DYLD_LIBRARY_PATH` half. The
omission was invisible for as long as no bridge in that step needed a host GNOME
library by bare leaf: every one of the eight either binds a portable C library or,
like `Gwebgl`, reaches GL without Gtk. `@gjsify/webkit-native` is the first whose
typelib references `libgtk-4.1.dylib`, and it failed on the arm64 leg with GJS's
own `overrides/Gtk.js` unable to load — a THIRD hand-written copy of the same
rule, found by adding coverage rather than by a consumer. It is now spelled the
way the other two are; the shared-helper question this entry is about applies to
it as well.

The CLI cannot IMPORT node-gi's copy: ADR 0005 Decision 2 forbids a Tier-1 package
taking a `dependencies`/`optionalDependencies` edge on `@gjsify/node-gi`, and the
audit (`scripts/manifest-conformance/rules/tier.mjs`) names it explicitly. So the
module is a **pinned mirror**: `packages/infra/cli/src/utils/system-gi.spec.ts`
imports node-gi's `system-gi.js` by relative path (legal in a spec — it is bundled
only into `dist/test.node.mjs`, never into the published `lib/`, so no dependency
edge exists) and asserts both implementations return identical arrays over a table
of ten injected host shapes. That is the repo's own sanctioned shape for a
deliberate duplicate, the same one `impliedExampleNodeEntry()` uses against the
CLI's `resolveNodeEntry()`.

What is still owed is the lift to ONE home — a small shared package both may
depend on (`@gjsify/system-gi`, Tier 1, no GI and no addon, so nothing about ADR
0005 is weakened by it). Not done here because a NEW npm name is the expensive
path in this repo: a manual first publish plus the Trusted Publisher bootstrap,
and the `@gjsify/tls-native` incident showed a half-bootstrapped name stalling
60+ packages. Do it on the next release cut that already has that ceremony open,
delete both copies and the agreement suite in the same change.

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

### Bun DID hard-crash in the N-API teardown class — the first one, and the note that predicted it asked to be told

**Cross-reference (added 2026-08-06): #925 files the same `test/arrays.test.mjs` occurrences as a TEST FLAKE, while this entry files them as an N-API teardown crash class (`free(): invalid pointer`, a glibc abort). Same file, two theories. Whichever is right, the next occurrence should be read from the RAW job log for a `----- Native stack trace -----` block, which is what tells the two apart.**

`scripts/cross-runtime.mjs` carves Deno out of exit-code gating for the
post-pass teardown abort (#47) and deliberately does NOT carve out Bun, on
measured grounds: *"~7000 Bun runs (arrays + the GObject/boxed-heavy files …,
full 37-file suite ×40, a probe holding 30k live boxed handles to process exit,
random `--smol` GC pressure) produced 0 crashes / 0 cores"*, and it closes with
an instruction — **"if Bun ever hard-crashes here, re-confirm with a gdb
backtrace (the Deno determination's bar) first."**

It has now happened, twice, on PR #923's CI (`ci-fedora:44`, bun 1.3.14,
`NODE_GI_NATIVE=prebuild`):

```
test/arrays.test.mjs:
  (pass) GStrv return → string[] … 8/8 assertions pass
free(): invalid pointer
  ✗ arrays
```

Note the marker: `free(): invalid pointer` is a **glibc heap abort**, not the
`SIGSEGV` inside `g_boxed_free` that the Deno determination is built on, and not
Bun's own `panic(main thread)`. Same family (a corrupt pointer reaching the
allocator at teardown, after every assertion has passed), different
manifestation — so the mechanism argument for Bun (deferred finalizers, run
single-threaded on the JS thread under `DeferGCForAWhile`, `napi_internal_remove_finalizer`
dedup) does not obviously cover it and should be re-checked rather than assumed.

Nondeterministic, and independent of that PR's contents: attempt 1 failed on
bun, attempt 2 on **deno**, attempt 3 passed, all on one commit; the job runs
`npm install` + node-gyp inside `packages/node-gi/node-gi` (sole dependency
`node-addon-api`), so nothing in that PR is reachable from it; the CI images
either side of the first failure are package-identical (797 packages, empty
`diff`, same `glibc-2.43-6`); 10 local `--only arrays` runs on unmodified `main`
were green.

**The RATE has changed, and that is the part the "~7000 runs / 0 crashes"
baseline no longer describes.** Three further hits inside one afternoon
(2026-08-02), all on `deno`, all on `arrays`, all on PRs that touch nothing
under `packages/node-gi/`:

| run | PR | outcome |
|---|---|---|
| 30751987456 | #935 | `✗ arrays`, re-run on the SAME commit → green |
| 30754859011 | #935 | green (the re-run above) |
| 30757696374 | #929 | `✗ arrays`, re-run on the SAME commit → green |

Every one stops at the identical place — nine assertions `ok`, then the process
disappears part-way through `INOUT byte-array container is handled, not
deferred: GLib.base64_decode_inplace()`, with no `ok`, no failure text and no
crash marker in the job log. That is a THIRD manifestation: not the
`SIGSEGV` in `g_boxed_free` of the Deno determination, and not the
`free(): invalid pointer` glibc abort recorded above — just a vanished process.
The absent marker is itself information: whatever kills it is not reaching the
glibc allocator's own check.

Two things follow. First, "nondeterministic" is now too weak a word for
planning — at roughly one hit per two runs on deno it is frequent enough to
reproduce deliberately rather than opportunistically, which removes the main
practical obstacle to the gdb step below. Second, anyone reading the 7000-run
baseline should know it was measured on BUN; nothing of that size has been run
against deno.

Next step is the one the note names, not a carve-out: reproduce under gdb (the
Deno case took ~8 cores on a loop of the boxed-heavy files) and get a backtrace.
Until then Bun stays on exit-code gating — a `pass>0 && fail===0 && <crash
marker>` carve-out added now would mask exactly the real Bun teardown bug this
might be, and the runs above show the marker is not even reliably present.

### The prebuild glibc floor is OBSERVED, never CHOSEN (#924)

The gate half is CLOSED (#1009): `scripts/check-staged-prebuild-libc.mjs` now
runs as "Gate on the glibc floor of what this leg just built" in both build legs
of `prebuilds.yml` (native `:722`, QEMU `:967`), both of which run on
`pull_request`, and the legs carry `nodejs` in their `dnf install`. The staging
question that blocked it is settled too: legs stage via `stage-prebuild.mjs .
--scratch` into the bridge's own scratch directory while the committed binaries
live in the platform packages, so the gate measures the NEW bytes rather than
the old committed ones. A green PR predicts a green main here now.

The #897 incident that produced all of it is preserved where it can still act:
a 33-line banner at `prebuilds.yml`'s `container:` line records that the 43 → 44
bump moved the measured floor 2.39 → 2.43 (glibc 2.43 re-versions
`acosf`/`asinf`/`atan2f`, which lightningcss's colour conversion calls) and
red-lined main for three consecutive `commit-prebuilds` runs. It is pinned to
`fedora:43` for that reason, not by habit.

**What is still open is the deeper half, and it is a policy question, not a
patch.** The floor is a number someone reads off the build image. Even pinned to
`fedora:43` it moves the day that image's glibc re-versions something else.
Choosing it means building the three Rust bridges against a DECLARED baseline —
an old-glibc container (manylinux/RHEL-derived) or `cargo-zigbuild --target
<triple>.<glibc>` — so that `gjsify.glibcRequires` becomes an input the build
satisfies rather than a result it reports. The question underneath is "how old a
distro do we support?", which is why #924's own comment notes its title no
longer describes the state.

### Bundle determinism is unmeasured now that nothing is byte-compared against a commit

ADR 0002 untracked `cli.gjs.mjs` and `tsc.gjs.mjs`, which retires the failure this
entry used to track — a committed bundle that does not rebuild from its own source.
Four mechanisms produced it and all four are gone with the artifact: the
module-order `$N` minifier drift, a stale dependency closure, a release cut
restaling every open PR through the version baked into `buildHeaders()`'s
user-agent, and a rebase silently 3-way-text-merging two minified bodies with no
conflict and no size anomaly.

**What is left is the residual none of those explained**: whether a FULLY rebuilt
closure still emits a different `$N` suffix assignment on a different host. It was
observed once (a local 6595935 B variant matching neither the committed 6594685 B
nor CI's 6594347 B, provenance never established) and never reproduced after the
stale-closure cause was found. With the bundles untracked there is no longer a
committed copy to compare against, so the question has to be asked a different way:
build twice on ONE host with the build cache cleared in between, and compare. That
is the `--determinism` mode owed to `release-cut.yml` per ADR 0002 § Do not.

Its honest limit, which must be stated wherever it lands: it catches a
re-emergence of the ordering class on one host. It does NOT catch cross-host
divergence, which is what the original symptom actually was. Closing that needs
two hosts building the same commit, which nothing in CI does today.

`affected.gjs.mjs` IS still byte-compared (`scripts/verify-committed-bundles.mjs`),
so the guard exists — it just covers 248 KB instead of 10 MB.

### `@gjsify/http2` lazy native-dispatcher loads still use a bare `require`

Two sites load the optional native HTTP/2 dispatcher through a bare `require(...)` from ESM source — `src/client-session.ts` (`_setupNativeClient`, reached from `connect()`) and `src/server/http2-server.ts` (`_startNativeListen`, reached from `listen()`). This is the class documented in AGENTS.md § CJS-ESM Interop → "Our source is ESM": the call resolves at build time inside a bundle and is a `ReferenceError` from the unbundled `lib/` we publish. Neither obvious fix applies as-is:

- a **static import** would pull `native-{client-,}dispatcher`'s static `gi://GLib` / `gi://Gio` / `@gjsify/http2-native` imports into EVERY http2 consumer, defeating the optional-native-package design;
- **`await import()`** (the ESM way to lazy-load) requires making both call paths async, i.e. changing `connect()` / `listen()` — and Node's `listen()` contract is synchronous.

So it needs a real design decision inside `@gjsify/http2` (e.g. resolving the dispatcher during an already-async phase, or an explicit async opt-in), not a lint fix. Both sites carry an `oxlint-disable-next-line typescript/no-require-imports` with the reason inline; they are the only sanctioned disables of that rule in the tree.

### Manifest-conformance follow-ups

The five standalone declaration-vs-reality scripts are now one rule registry (`@gjsify/manifest-conformance` + `scripts/manifest-conformance/`). Three things were deliberately left out of that refactor so it stayed a refactor.

- **`gjsify manifest-check` is designed but not shipped.** The portable rules (`package-outputs`, `prebuild-artifacts`, `headless`, `field-coverage`) are already extracted into a package with a hand-written `lib/index.d.ts`, so the command is a thin wrapper over `selectRules({ scope: 'portable' })`. It was held back because it carries two costs a refactor must not smuggle in: the package has to flip from `private` to published, which needs the manual first-publish + Trusted-Publisher bootstrap BEFORE the next release train, and adding a command rebuilds `dist/{cli,affected}.gjs.mjs`, coupling the change to the committed-bundle gate. The name is settled: `manifest-check` — a sibling of `system-check` (machine has what the project needs) and distinct from `check` (types compile). Evidence it is worth doing: downstream consumers already declare `gjsify.storybook` (buchhaltung, pixel-rpg/map-editor) and `gjsify.prebuilds` (buchhaltung's ERiC package, which declares a prebuilds directory with NO `gjsify.platforms` — a hard failure in this repo, unchecked in theirs).
- **Five `gjsify.*` declaration kinds have no rule** and are deferred with a written reason in `scripts/manifest-conformance/unchecked-fields.mjs`, printed on every audit run. All four remaining are judged unverifiable-by-construction (`defineFromPackageJson`, `flatpak`, `buildCache`, and `nativescriptPlatforms` until there is a per-platform artifact to compare against). The one entry that was a real FINDING — `gjsify.storybook` — is CLOSED: the portable `storybook` rule now resolves the declared directory the way `gjsify storybook` does and fails a path that does not exist or holds no `*.story.*`. Its ledger wording had gone stale as well: the 'empty browser, not an error' shape is the pre-#879 behaviour, when a bare `process.exit(1)` was deferred under GJS and the no-stories path fell through into the build and exited 0. That incident moved into the rule's header rather than being deleted with the entry. `gjsify.main` and `gjsify.example` left the ledger when `package-outputs` claimed them.
- **`gjsify pack`'s own shipped-vs-declared guard is still types-only, and the same `private` flag is why.** `assertTypeDeclarationsShipped` refuses to pack a `types`/`typings` file it can see but would not ship (the #655 guard) — the right place, because it fires at the moment of packing and protects CONSUMER trees too. The superset (every declared entry point, not just the type fields) lives in `scripts/verify-tarball-outputs.mjs` instead, because it needs `declaredPaths()` from this package and a published `@gjsify/cli` cannot depend on a `private: true` one — the same blocker as `gjsify manifest-check` above, and it closes with the same npm bootstrap. Measured gap while it stands: narrow a package's `files` so only `lib/esm/register.js` is excluded and `gjsify pack` exits 0 and writes a tarball whose declared `exports["./register"].default` is absent (13 type files shipped, so the existing guard stays quiet); the script catches it. Fold the script's check INTO the packer when the package is published, and keep the script as its repo-wide sweep.

### Toolchain hygiene follow-ups

- **`scripts/node-gi-consumer-harness.mjs` still resolves `gjsify` the broken way, knowingly.** `resolveGjsify()` returns `node_modules/.bin/gjsify` on an `existsSync` hit, which on Windows is the `sh` member of npm's shim trio and the one member the OS cannot execute — `execFileSync` gets ENOENT. `scripts/resolve-gjsify.mjs` is the fix and both other callers now use it; this one is not a one-line change. The working Windows form is `%COMSPEC% /d /s /c "<shim> <escaped args…>"`, which embeds the ARGUMENTS inside the quoted line, so the resolved command cannot be threaded through this file as the bare string that `runPackage`, `stageTestAssets` and the rest pass around — each site has to build its own invocation (`execGjsify(args, opts)` instead of `exec(gjsify, args, opts)`). Left because the harness drives `@gjsify/node-gi`, which needs GObject-Introspection and is Linux-only in practice, so there is no Windows run to repair; rewriting the threading blind on a harness this host cannot exercise would trade a known unreachable bug for an unmeasured change. Do it when the harness is next touched anyway.

- **A repo-relative path spelled in the HOST separator — CLOSED.** The entry asked for "either a documented rule … or a helper the call sites must go through"; both now exist. HELPER: `posixRelative()` / `toPosixPath()` are exported from `@gjsify/manifest-conformance`, so the one rule every repo-relative path in this tree depends on has exactly ONE definition — `audit-runtimes.mjs`'s local `toPosixRel` was byte-identical to `context.mjs`'s normalisation and is now an alias of the shared one. RULE: `docs/code-anti-patterns.md` carries it with both incidents intact (`classifyAxis` reading a `\`-separated path as a single segment, so five infra packages were reported as missing a declaration they must not carry; `platforms-ci` compiling a `\`-separated path into a regex in which `\n` is a NEWLINE, so node-gi's macOS leg read as a declared platform CI never builds) — both red on win32 and green on Linux for the same commit. The five `scripts/` sites that used the `replaceAll` spelling now go through the helper; that spelling is not merely uglier but WRONG, since a backslash is a legal POSIX filename character, so it trades a Windows bug for a POSIX one. Deliberately NO separate check watching for a raw `relative()`: a guard watching another mechanism is the named smell, and it could not distinguish a display string (where the host separator is arguably right) from a value about to be split. `windows-suites.yml` is what would catch a re-break, this whole class being invisible from Linux.

- **Testing "on Windows" from git-bash reports false greens, and nothing enforces the distinction.** Git for Windows puts `C:\Program Files\Git\usr\bin` on PATH, which supplies a real `chmod`, `cp`, `rm`, `sed` and `which`; every process spawned from that shell inherits them. npm, however, runs package scripts through `%COMSPEC%` (cmd.exe), where none of those exist. The two disagree on the same tree at the same commit — measured: `gjsify run build:infra` completed under git-bash and failed at `@gjsify/create-app` under cmd.exe, and `detectPackageManager()` in `utils/check-system-deps.ts` probes with `which`, which is ENOENT under cmd.exe (it returns the honest `unknown` there, but by accident rather than by construction). Any Windows claim therefore has to name the shell, or it means nothing. The reproducible check is to strip every `\Git\` entry from PATH and drive the command through `%COMSPEC%`; that is what the measurements behind 293a9a1 and this entry used. Worth a scripted harness in `tests/` if a Windows CI leg ever lands, since the runner images have Git on PATH too.

- **"744 files are committed with CRLF" — CLOSED, and it was NOT true at the commit that recorded it.** The entry claimed a fresh `git -c core.autocrlf=true clone --depth 1` reports 744 modified files immediately, by a mechanism it also stated: *"those blobs already contain CRLF"*. Re-measured on the win11-gjsify VM at `main`, two ways that agree:
  - **no tracked blob contains a CR byte at all.** `git grep -I -l $'\r' HEAD` → 0 of 4778 files; `git ls-files --eol` → 4294 `i/lf`, 381 `i/-text`, 95 empty, 8 `i/none`, and **zero** `i/crlf` or `i/mixed`.
  - **the reproduction produces nothing.** `git -c core.autocrlf=true worktree add --detach <tmp> HEAD` followed by `git -C <tmp> -c core.autocrlf=true status --short` → **0 modified files**, over all 4781 entries.

  The stated mechanism REQUIRES CR in the blobs, so with zero CR blobs it cannot occur — the two measurements are not independent confirmations, they are the claim and its precondition, both absent. Nothing in the history between then and now renormalises anything (`git log --all --grep` over renormal/line-ending/crlf/eol finds only the doc commits themselves), so the original measurement was most likely taken against a working tree rather than the index. Recording that here rather than deleting silently: the entry was about to justify a repo-wide `* text=auto` + `git add --renormalize .` sweep, a project-wide policy change with a one-time 744-file diff, and **that work does not need doing.**

  What remains TRUE and is worth keeping: `.gitattributes` (a9fa31a) pins the byte-verified artifacts with `-text`, and that is load-bearing — `core.autocrlf=true` would rewrite them and `verify-committed-bundles.mjs` would report them stale for files nobody touched. Since ADR 0002 untracked both `*.gjs.mjs` bundles the exposure is smaller, but `packages/infra/tsc/lib/**` and the prebuild payloads still need it.

- **`release.yml`'s two `napi-prebuild-*` legs staged by hand — CLOSED.** Both now call `node ../../../scripts/stage-prebuild.mjs .`, so the release path gets the extension match and `checkPrebuildDir()` like every other staging site, and `tests/e2e/prebuild-change-gate` scans `release.yml` too — the exemption cannot come back. The same change added the load test those legs were missing: they ended at `cp` + `upload-artifact` while `publish-napi` checked four files with `test -f`, so nothing proved a released artifact could be opened. Landing it after a release, not beside one, was the reason it waited.
- **Nine fixtures re-implement the prebuild-target name instead of importing it.** `resolvePrebuildDirName()` / `prebuildDirCandidates()` (`packages/infra/cli/src/utils/detect-native-packages.ts`) are pure functions and already the single source of truth for `prebuilds/<os>-<arch>/` — but every e2e that needs that directory composes the name itself, and several translated `process.arch` into the `uname -m` machine on the way. The `<os>-<arch>` unification had to fix all nine by hand, and one (`tests/e2e/self-host/run.mjs`) was missed on the first pass precisely because the composed string never appears as a literal. Export a small test helper (or let fixtures import the CLI's built `lib/utils/detect-native-packages.js` directly, the way `tests/e2e/dlx-native-prebuilds` already imports `run-gjs.js`) so the name has exactly one definition, and delete the per-fixture copies. Until that lands, any change to the target vocabulary must be swept for BOTH shapes — the literal path AND the computed one.
- **`gjsify install` materialises EVERY platform package, so a cold install does ~4x the necessary work — this, not a wedge, is what the 30-min budget hits.** Measured on a fresh clone (linux-x64, warm tarball cache, 2026-07-28): 1597 packages / **4.78 GB** extracted, of which **183 packages / 3.36 GB (70% of the bytes)** declare an `os`/`cpu` that EXCLUDES the host, so npm/yarn/pnpm would never place them — six `@anthropic-ai/claude-agent-sdk-*` siblings at ~230 MB each, six `@pagefind/*`, plus the `@rolldown`/`@oxlint`/`@oxfmt`/`@img/sharp`/`@deltachat` binding sets. The fix is to honour `os`/`cpu` like every other package manager, and it is a TWO-part change because `--immutable` materialises straight from `gjsify-lock.json`: record `os`/`cpu`/`libc` on lock entries at resolve time, and filter at materialisation. That is a lockfile-format change + a full `gjsify-lock.json` regeneration, so it wants its own PR + e2e; the napi-rs entry-replacement in `napi-node-addon.ts` already selects its sibling BY HOST TRIPLE, so it is unaffected. Do NOT "fix" this by raising `--timeout`: a budget that exists to bound a hang must not be tuned to accommodate one.

### CI coverage follow-ups

- **`prebuilds.yml` covers every Linux target on a PR; `darwin-arm64` is still proven for the first time AFTER the merge.** The workflow runs its BUILD legs on `pull_request` (native x64 + arm64 and the ppc64/s390x/riscv64 QEMU legs, Vala *and* the three Rust bridges — the break that motivated it, #827, was in the Rust dependency graph). Under real qemu-user (10.2.2, ppc64le): dependency install ~6 min, the Vala/GI packages compile in minutes; `@gjsify/lightningcss-native`'s Rust cdylib is the one expensive step — if a leg's total makes it the PR critical path, drop THAT package from the emulated legs rather than the architecture. `build-prebuilds-macos` remains the one PR-skipped leg (10x billing + the shared macOS concurrency pool); label a PR `ci:macos` to opt in. `prebuilds-summary` names the skipped legs per run. Closing the macOS gap permanently means either paying 10x per PR or a nightly full-matrix run. Pairs with the "nothing byte-compares a committed prebuild against a CI-built one" item below.
- **`@gjsify/rolldown-native`'s darwin-arm64 leg is PROVEN but not promoted, so `gjsify build` still has no bundler engine on macOS.** As of run 30271998319 the manual-dispatch `build-prebuilds-macos-experimental` job builds the Rust cdylib + Vala bridge on a real Apple-silicon runner, stages BOTH libraries, passes `check-prebuild-loader-path.mjs`, loads under Homebrew `gjs` and resolves its sibling cdylib with `DYLD_*` unset — every gate the required job applies to `lightningcss-native`/`oxfmt-native`. Missing is only the promotion: a build+collect+upload step in `build-prebuilds-macos`, `darwin-arm64` in the package's `gjsify.platforms`, and the download+commit wiring in `commit-prebuilds`. Until then the one job that covers the bundler engine on macOS runs on no automatic event.
- **`linux-ppc64`, `linux-s390x` and `linux-riscv64` have a working emulated BUILD but no committed prebuild yet, on all eight bridges that declare them.** Two defects stacked historically: `uraimo/run-on-arch-action` ignored the architecture whenever a custom `base_image` was set (the legs compiled x86-64 and staged it as ppc64/s390x/riscv64), and it reset binfmt to a qemu 7.2 under which Fedora's package manager does not survive emulation. The job now registers a pinned current qemu (`tonistiigi/binfmt:qemu-v10.2.3`) and runs `.github/prebuild-toolchain/emulated-build.sh` in the target-arch image. The mis-staged x86-64 artifacts were removed and each package records the gap in `gjsify.platformsUncommitted`, printed by `audit-runtimes --check` on every run. **A `commit-prebuilds` run on `main` is what closes it** — the audit then requires the `platformsUncommitted` entries to be deleted in the same change. Until then an exotic-arch consumer gets no native bridge and the guarded `imports.gi` probes degrade, which is the honest state rather than the previous unloadable one.
- **Fork PRs have no working CI at all.** Every container job pulls the PRIVATE `ghcr.io/gjsify/ci-fedora:<major>`, and a fork PR's `GITHUB_TOKEN` cannot read another repo's private package. Either publish the image publicly (it contains nothing secret — a Fedora + GNOME devel stack) or accept that external contributions cannot be validated until a maintainer pushes the branch.

### Cross-runtime reachability follow-ups (ADR 0014)

- **Nothing byte-compares a committed prebuild against a CI-built one.** `scripts/check-refs-pin.mjs` (wired into every `build:meson`) catches the three ways a locally-built native artifact diverges from its pinned source — checkout drift, version skew against the npm engine, and a stale `build/` dir ninja will not invalidate. What it cannot catch is a binary that was simply never rebuilt: the `rolldown-native` prebuild had drifted BEHIND its pin for an unknown number of commits and only surfaced when a rebuild finally happened. Close it by having `prebuilds.yml` rebuild and diff the committed artifact (or publish the CI-built one as the source of truth and stop committing hand-built binaries).
- **Three browser bundles are ledgered as NON-GATING in the `browser` CI job.** The axis runs (`main.yml` `browser` job: Playwright/Firefox over the bundles the Fedora `build` job stages, 51 discovered, 48 gating-green), but `$BROWSER_PROBE_GREP` carves out three that were red the moment it was first executed. (a) **`@gjsify/events`** and (b) **`@gjsify/util`** both declare `src/test.browser.mts` as `export * from './test.js'` — re-running the GJS/Node spec files in a browser, which AGENTS.md explicitly forbids (`events` hangs; `util` dies on a bare `process.env` read in one spec). (c) **`@gjsify/streams`** feeds STRING chunks into `new Response(stream).text()` in three cases; per the Fetch spec a body stream must yield `Uint8Array`, and Firefox enforces it where Chromium and undici are lenient — the spec needs `TextEncoderStream` in front of the `Response`. **The same forbidden `export * from './test.js'` shape is in 11 packages** (`assert`, `async_hooks`, `buffer`, `constants`, `diagnostics_channel`, `events`, `path`, `querystring`, `string_decoder`, `sys`, `util`); the other nine pass only because their specs happen to be pure logic. Rewrite all 11 to browser-globals-only entries, then delete the ledger.
- **`@gjsify/worker_threads` ships a `src/browser.ts` with NO browser-axis test coverage.** No `index.browser.spec.ts` backs its `test.browser.mts`, so nothing ever asserted against that entry — which is how the exported `workerData` stayed permanently `null` (fixed, found by reading rather than by a failing test). `@gjsify/zlib`, `@gjsify/vm` and `@gjsify/http` show the pattern to copy. Worth doing before the package is considered for `partial` → `polyfill`, since export parity alone would have passed that bug.
- **`@gjsify/web-globals` declares `node: "polyfill"` but re-exports `@gjsify/webaudio`** (`node: "none"`, hard-bound: `gi://Gst?version=1.0` + a top-level `Gst.init(null)`) from `src/index.ts` and `src/register.ts`. A `--app node` bundle therefore hard-requires the external `@gjsify/node-gi` at module load. Fix by downgrading the slot to `partial` or adding a `src/node.ts` platform entry. Reported on every `audit-runtimes --check` run.
- **The ten `browser:"partial"` slots are RESOLVED as partial — the residual work is per-package, not a slot sweep.** All ten were audited against the `platform-entry-parity` gate; none is promotable, because in every case a NAMED export is unavailable on the browser platform itself (the blocking export per package is recorded in each package's status entry / AGENTS.md row). Parity is necessary but not sufficient — it passes `sqlite`, whose `DatabaseSync` throws from its constructor; treat a green parity gate as permission to look, not a mandate to promote. Still open, per package: **`fs`** — close the 34-export gap over the in-memory `Volume` (does NOT unblock promotion while `FSWatcher` is a never-firing stub); **`sqlite`** — add a `./browser-worker` subpath declared `polyfill` backed by OPFS `createSyncAccessHandle`, leaving `./browser` at `partial`; **`ws`** — the only one of the ten without a `src/test.browser.mts` (its browser entry is 93 LOC; a small spec asserting the `WebSocketServer` ENOTSUP shape + CJS-compat statics closes it); **`crypto`** — only 2 of its 25 root modules have a platform dependency (`GLib.Checksum` in `src/hash.ts`, the `imports.gi` fallback in `src/random.ts`); replacing those makes the ROOT browser-clean with full synchronous Node semantics — the one path that would actually earn `polyfill` — and retires the 1,774-LOC `src/browser/` duplicate.
- **The `native` runtime slot means two different things, and the NativeScript bridge packages use the wrong one.** The routing rule reads `native` as "the RUNTIME provides this API — resolve to `<pkg>/globals`", but `packages/nativescript-bridge/*` declare `nativescript: "native"` in the sense "this package IS the native implementation". None of them ships a `globals.mjs`, so all five resolve to `@gjsify/empty` with a warn-once on ANY `--app nativescript` build that imports them BY NAME — a shipping bug, not a latent one. It also blocks `ALIASES_NODE_FOR_NATIVESCRIPT` from being composed through `withDerivedSlotRouting`. Fix by settling the vocabulary (either a new slot value for "this package is the runtime-native impl", or re-declaring the five as `polyfill`) — an ADR-sized decision because it changes a published `package.json#gjsify.runtimes` contract and `scripts/audit-runtimes.mjs`. Compose the NS table in the same change.
- **23 `native` slots ship a `globals.mjs` NARROWER than their root entry — 152 export names that are a `MISSING_EXPORT` waiting for a consumer.** A `native` slot routes the package ROOT to `@gjsify/<X>/globals`, exactly as `polyfill` + a declared subpath routes it to `src/<target>.ts`, so the `platform-entry-parity` invariant applies verbatim — and nothing checked it: the `globals-broken` probe only validates the `export … from '<spec>'` SOURCES a `globals.mjs` names, so every hand-written `export const X = globalThis.X` file passed it vacuously. Found when a `--app browser` build of `@gjsify/gamepad`'s OWN README example died with `"hasGamepadBackend" is not exported by "packages/web/gamepad/globals.mjs"`. `audit-runtimes --check` now REPORTS the whole set every run (`globals-entry-parity`, check 5 in `auditReachability`); making it fatal is a separate, cross-cutting change (AGENTS.md exception (c)) because the tree cannot pass it today. A further 17 packages are deliberately NOT compared and the skip is printed with them: their `globals.mjs` star-re-exports a runtime module (`export * from 'node:util'`), which surfaces the whole runtime surface and is not statically enumerable — reading those as gaps was the first version of this check crying wolf on 17 packages that are in fact complete, and `tests/e2e/runtimes-routing` disproves it by importing `format`/`inspect` through exactly that file. The skip carries a residual blind spot: a `globals.mjs` that stars a runtime module AND has a root export that module does not carry is skipped too, so a real gap there is invisible. Closing it means asking the runtime for the star target's export set — runtime EVALUATION, which `audit-runtimes` deliberately does not do (it must not crash on a browser-only re-export), so it needs its own decision rather than a quiet widening of this check. Two shapes hide in the remaining 152, and only one is a re-export away: names the RUNTIME provides (`@gjsify/assert`'s `strictEqual` from `node:assert`, `@gjsify/webcrypto`'s `Crypto`) versus names it does not (`@gjsify/gamepad`'s Manette→W3C mapping tables) — no `globals.mjs` in the tree imports its own package body, so the second shape needs a platform entry, i.e. a slot decision, not a line in `globals.mjs`.
- **Rolldown 1.1.4 emits the `keepNames` helper AFTER its first use.** With `output.keepNames = true` (gjsify's default whenever `minify` is on) a minified bundle can contain `__name(fn, 'x')` at byte ~200 while the helper declaration appears ~9 kB later; `var` hoisting makes the early call `TypeError: __name is not a function`. Reproduced on `--app node` with the `@gjsify/module` node-gi test bundle (the `\0gjsify-gi-node:*` virtual module is ordered first); `--minify false` runs. Upstream (`refs/rolldown`, pinned `v1.1.4` in lockstep with `@gjsify/rolldown-native`) — needs a minimal reproducer filed, or a chunk-prelude workaround if the pin cannot move.

### `--app node` genuine-GJS-source detection is narrower than the reverse bridge it gates

`nodeGiGlobalsInject` keys on BARE ambient globals (`print`/`imports`/`ARGV`), so a genuine GJS source that uses `gi://` but logs via `console.log` — and passes no explicit `--globals` — is not recognised: its `@girs/*` value imports are emptied (`class extends undefined`) **and** its `/register` imports route to `@gjsify/empty`. Verified with both probes. This pre-dates ADR 0012 and hits `@girs/*` and registers equally; ADR 0012 only brought the two into parity via the single `isGjsSourceBuild` gate in `app/node.ts`. Fix by widening the SIGNAL itself — e.g. treat "a `gi://` specifier survived in the bundled graph" as a reverse-bridge build — which closes both at once.

### `@gjsify/node-gi` — a pointer struct FIELD whose length lives in a sibling field marshals EMPTY

`GstMapInfo.data` is a `guint8*` field whose length is carried by the sibling `size` field — a dependency GI cannot express for a struct-field READ. gjs resolves it; node-gi returns an empty array, and reports no error while doing so. Measured on a decoded audio sample: `map: ok=true size=8192 data.length=0` while `buffer.extract_dup(0, 8192)` returns 8192 bytes. That silent zero is what made audio inaudible on node for a whole investigation: every layer above reported success on an empty buffer. `@gjsify/webaudio` now uses the copying `gst_buffer_extract_dup`, which works on both runtimes — but any consumer reading a length-in-a-sibling-field pointer will hit this, and the empty result is indistinguishable from a genuinely empty buffer. Fix shape: honour the GIR's `array length=` annotation on struct FIELDS in the field reader (the call-argument path already does), and where the annotation is absent, prefer failing loudly over returning an empty array.

### `@gjsify/node-gi` — `GTK_IS_EVENT_CONTROLLER` assertion failures on the reverse bridge

Running any GTK app through node-gi intermittently produces `Gtk-CRITICAL **: gtk_event_controller_handle_crossing: assertion 'GTK_IS_EVENT_CONTROLLER (controller)' failed` and can take the process down mid-frame. NONDETERMINISTIC, which is the trap: single runs prove nothing in either direction. Measured on the showcase — node 1/6/1 criticals over three consecutive runs, bun likewise, deno clean in the same sample. It is INDEPENDENT of audio (still occurs with audio gated off, and on code predating the GValue marshalling fix). The event controllers are attached by `@gjsify/event-bridge` via `attachEventControllers`, so the likely shape is the JS wrapper for a controller being collected while GTK still holds the C object — a toggle-ref/lifetime question, not a GStreamer one.

### `@gjsify/node-gi` — the `$gtype` surface is incomplete

gjs exposes `$gtype` uniformly (`[object GType for 'X']`); node-gi does not, and the three shapes fail differently — measured against gjs on the same source: `Gio.ApplicationFlags.$gtype` is `undefined` (`makeEnum` freezes a plain member object, no lazy getter); `GLib.Variant.$gtype` is a static-method THUNK (`$gtype` falls through the struct proxy to method resolution); `String(Gio.Application.$gtype)` throws `Cannot convert object to primitive value` (the GType handle is a bare tagged External). The handle works fine as an ARGUMENT (`GObject.Value.init(GObject.TYPE_STRING)` round-trips), so this is a surface gap, not a marshalling one. Fix shape: attach the same lazy `$gtype` getter `defineLazyGType` gives classes to `makeEnum`'s frozen object and to the struct path that misses it, and give the GType handle a `toString`/`Symbol.toPrimitive` + `.name` so it prints like gjs's GType object.

### `@gjsify/node-gi` — nothing in CI runs the bridge against MUSL, or against the declared gjs floor

The arch axis is covered: `node-gi.yml`'s `arm64` leg builds the addon on a native `ubuntu-24.04-arm` Fedora 44 container, runs the gjs/node/bun/deno golden-diff plus the tier-B typelib oracle, and re-verifies the STAGED prebuild with `test:bun`+`test:deno`. Two other axes are not, and a 2026-08-03 hand run on a OnePlus 6T / postmarketOS (aarch64) is currently their only evidence:

- **musl.** Every CI image is Fedora/glibc, and the one leg that would cover it is not wired: `prebuilds.yml`'s `build-prebuilds-musl` (which runs `.github/prebuild-toolchain/musl-build.sh`, including its `dlopen(RTLD_NOW)` assertion, in `alpine:3.24`) carries `if: github.event_name == 'workflow_dispatch'` — the workflow header documents it and `build-prebuilds-macos-experimental` as dispatch-only with nothing depending on them, since each builds a target no `gjsify.platforms` declares yet. So NOTHING asserts musl loadability on a PR or a merge today. That the assertion is `RTLD_NOW` is not incidental and must not be "simplified": measured with `@gjsify/sab-native`'s pre-#955 prebuild on aarch64 musl and in `alpine:3.24` x86-64, a plain/lazy load LOADS the broken library and the two unresolvable symbols (`fcntl64`, `__cmsg_nxthdr`) only surface at the first call — which is why its suite lost exactly two fd-passing tests and `@gjsify/worker_threads` four cross-process tests instead of everything, and GI's own `G_MODULE_BIND_LAZY` is that lazy path. A load-only gate using default flags would have passed that library; `RTLD_NOW` fails it at load. Both arches behave identically here. Wiring options, cheapest first: run `musl-build.sh` (or just its `dlopen(RTLD_NOW)` step over the committed prebuilds) on `pull_request`; add an Alpine leg driving the existing `test:bun` for real execution coverage; and keep the glibc-floor `SHT_GNU_verneed` audit (#963) as the check that needs no musl machine at all — it is what caught this one. Deno cannot participate in a musl leg: it publishes no musl build.
- **gjs 1.86.0, the declared floor.** Fedora 44 ships 1.88.x, so the floor this repo advertises is never exercised. Measured green through `org.gnome.Platform//49` (glibc 2.42, gjs 1.86.0), and it immediately caught a test encoding an unstated GLib ≥ 2.88 assumption (`GLib.Bytes.new_from_bytes` static-vs-instance introspection, fixed in the same change). A flatpak-runtime leg would be the honest gate; the GNOME runtime is a stable, pinnable image.

Also unmeasured on aarch64 specifically, in CI and by hand: the display legs (`gtk-smoke`, `adw-smoke`, `gtk-template*`, `strv-construct`, `interface-props`) and the `--expose-gc` toggle-ref stress leg — `gtk-smoke` is `ubuntu-latest` (x64), and the device is driven over SSH with no display. Note the GTK TYPELIB path itself is fine there: `Gtk`/`Gdk`/`Adw`/`Pango`/`Graphene` all resolve and `Gtk.DrawingArea` subclasses with NO `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH` help, on musl and inside the flatpak — the darwin "Failed to load shared library … referenced by the typelib" class is dyld-specific (no rpath on a plain `node`), not a Linux exposure.

### `@gjsify/node-gi` — the LOW-LEVEL `registerClass` still drops an unresolvable signal param type in silence

The L1 `GObject.registerClass` no longer does: an entry `signalSpecToNative` cannot turn into a type name now THROWS, naming the signal and the index (that silent drop is what made the GJS-canonical `param_types: [GObject.TYPE_INT]` register a zero-param signal and deliver an `undefined` payload). The engine's own loop is the second copy of the same mistake and is still there: `src/class.cc` reads each `paramTypes` entry with `TypeNameToGType(NodeGiToUtf8(...))` and does `if (t != G_TYPE_INVALID && t != G_TYPE_NONE) push_back(t)` — so `registerClass(name, ns, parent, { signals: [{ paramTypes: ['bogus'] }] })` from `@gjsify/node-gi` (the native passthrough, not the L1) still yields a signal with fewer parameters than declared and says nothing. Same for `returnType`. Fix shape: accept a GType HANDLE there too (`ReadGTypeHandle` first, name lookup second — the L1 already round-trips through the name, so this is only about the direct callers) and throw a `Napi::TypeError` naming the signal instead of skipping. Not folded into the L1 fix because it needs a native rebuild, and the host that measured the defect (aarch64 postmarketOS, deliberately node-free) cannot run `node-gyp`.

### `@gjsify/napi` — a tsfn claim nobody hands back still leaks its control block

`finalize_env_tsfns` (`src/cc/tsfn.cc`) partitions `thread_count` by owner; only the claims a foreign thread demonstrably holds are joined (2 s deadline). Whatever is still outstanding afterwards makes the tsfn DETACH — its JS-side resources are freed and the control block is handed to whichever thread returns the last claim, which then frees it. That is Node's `MaybeDelete()` posture and it closes the force-free UAF window for good, but it inherits Node's consequence: **if no thread ever returns the claim, ~840 bytes leak for the process lifetime** (measured: 264 direct + 576 indirect, valgrind, 0 memory errors). Both outcomes warn unconditionally. Two residuals worth a decision later: an unattributed claim a foreign thread genuinely holds is not joined (safe, but the warning can only say "never attributed" — closing it needs an ownership signal N-API does not expose); nothing reclaims a detached control block at process exit (a per-env registry of detached tsfns would trade the leak for a much harder lifetime question; today the leak is accepted because Node accepts it). Measured on every CI run by `test/tsfn-teardown-gate.mjs` (Linux + macOS legs).

### Regenerate the register-globals closure map after a `GJS_GLOBALS_MAP` change

`node packages/infra/cli/scripts/generate-register-closure.mjs` (`--check` reports staleness). A stale map is fail-soft — builds stay correct but pay extra `--globals auto` analysis passes. (The related hazard — the committed CLI bundle inlining a stale map — is closed: `.githooks/pre-commit` triggers on `packages/infra/resolve-npm/lib/` and `packages/infra/rolldown-plugin-gjsify/src/`.)

### `gjsify onboard` for `@gjsify/gtk-runtime-darwin-x64` — required before the release that ships it

npm Trusted Publishing (OIDC) cannot CREATE a package, only publish new versions of an existing
one, so the new name needs a one-time manual first publish + Trusted Publisher from a maintainer
machine BEFORE `release.yml`'s `publish-gtk-runtime-darwin` matrix runs its `x64` leg. An
unbootstrapped name 404s the OIDC exchange and stalls every alphabetically-later package (the
v0.4.20 `@gjsify/tls-native` incident: 60+ packages stuck). One command:
`gjsify onboard` (whoami-gated login, per-package state probe, publishes + trusts only the gaps,
ONE shared OTP). The package itself, its builder and both CI chains are in place.

### `gjsify onboard` for the three `@gjsify/webkit-native*` names — required before the release that ships them

Same mechanism as the `gtk-runtime-darwin-x64` entry above, three names at once: `@gjsify/webkit-native`, `@gjsify/webkit-native-darwin-x64` and `@gjsify/webkit-native-darwin-arm64` are all published (none is `private`), all new as of ADR 0022, and none exists on npm. Trusted Publishing cannot CREATE a package, so an unbootstrapped name 404s the OIDC exchange and stalls every alphabetically-later package — the v0.4.20 incident left 60+ at 0.4.19, and `webkit-*` sits ahead of `websocket`, `webstorage` and `xmlhttprequest`. One `gjsify onboard` run covers all three (it probes per package and publishes only the gaps, one shared OTP).

### `@gjsify/webgl` renders on darwin-x64, but no WebGL2 CONTENT can

First rendering proof on darwin, measured 2026-08-03 on the Intel macOS 15.7.8 test VM
(`docs/workstation/macos-test-vm.md`): the committed `darwin-x64` prebuild draws real pixels onto
the desktop through `Gtk.GLArea` + libepoxy + CGL — a `clearColor`/`scissor`/`clear` pattern,
`gl.getError()` 0, screenshotted. Everything before this proved a `dlopen`, not a pixel. The
`set_use_es(true)` defect that made it impossible is fixed (§ Bridge pattern).

**Read every measurement below with one precondition stated.** Each one was taken with
`DYLD_LIBRARY_PATH=/usr/local/lib` exported by hand, because without it the `Gtk-4.0` typelib's bare
`libgtk-4.1.dylib` leaf does not resolve on this host at all — the darwin loader defect #973 fixes.
So these results describe the GL stack ONCE libgtk is loaded; they do NOT say a user who runs
`gjsify showcase` on macOS gets that far, and the darwin webgl claim is contingent on #973 or an
equivalent. Worth naming explicitly because it is the same masking pattern #973 found in CI, where
the workflow exports `DYLD_FALLBACK_LIBRARY_PATH` itself and thereby hides the defect from every
job: a loader variable supplied by the harness rather than by the user's environment turns "it
works" into "it works for us". SIP makes it worse than a normal env var — `DYLD_*` is stripped when
exec'ing a protected binary, so putting `nohup`/`env` in front of `gjs` silently drops it and the
failure comes back looking like a broken prebuild.

What is still open:

- **GLSL ES 3.00 does not exist on macOS, so every WebGL2-only consumer is dead there.**
  `#version 300 es` needs ARB_ES3_compatibility (GL 4.3) and macOS caps CGL at 4.1; measured
  through the shipped stack, `gl2.compileShader` reports `version '300' is not supported`. WebGL1
  (`#version 100`) compiles. Consequence: `three-geometry-teapot`, `three-postprocessing-pixel` and
  the Excalibur showcases BUILD and RUN on darwin-x64 (the GLArea realizes, the log says
  `Context version: OpenGL 4.1`) and draw nothing, because three.js ≥ r163 and Excalibur 0.32 are
  WebGL2-only. Three honest resolutions — pick one deliberately rather than leaving the third
  state: (a) declare darwin WebGL1-only and say so in the showcase preflight + the platform matrix;
  (b) translate GLSL ES 3.00 → GLSL 4.10 in the Vala layer for a desktop-GL context (`in`/`out` are
  already common, the work is `texture()` sampling, `layout` qualifiers and the precision
  statements — this is what ANGLE does and it is not small); (c) ship/link ANGLE on darwin and get a
  real GLES 3 driver. Until one is chosen, "webgl works on darwin" must be stated as
  **WebGL1-only**, and the OS-axis declaration in `packages/framework/webgl/package.json` promises a
  loadable prebuild, NOT a WebGL2-capable one.
- **`getSupportedExtensions()` trips a GLib assertion on every desktop-GL context.**
  `g_strsplit: assertion 'string != NULL' failed`, three times per context: a core profile makes
  `glGetString(GL_EXTENSIONS)` return NULL (it is `glGetStringi(GL_EXTENSIONS, i)` + `GL_NUM_EXTENSIONS`
  there). The Vala side must read the indexed form when the context is desktop GL ≥ 3.0. Not fatal
  today — the JS layer still returned 3 entries — but it is a NULL deref away from one, and it is
  the same class as the `invalidateFramebuffer` gate: GLES semantics assumed on a GL context.
- **A `GL_INVALID_OPERATION` (0x502) is pending before the first draw**, and an `Adw.Application`
  app whose `WebGLBridge` draws from `requestAnimationFrame` produced a BLACK window while the
  identical tick-callback + `queue_render` + `render` mechanism animated correctly in a plain
  `Gtk.Window` + `GLib.MainLoop` (~13 renders/s on the software renderer). Two candidates, neither
  confirmed: a desktop GL core profile has NO default vertex-array object (a draw with VAO 0 is
  exactly `GL_INVALID_OPERATION`, while GLES permits it), and/or the `_gtkFboId` captured from
  `GL_FRAMEBUFFER_BINDING` is not the framebuffer GTK presents on this backend. Reproduce with the
  probe below plus a `--globals auto,dom` bundle that drives the real bridge; this is the next thing
  to chase, and it is what stands between "the native bridge draws" and "an app draws".
- **The HiDPI path stays unproven on darwin.** The VM reports scale factor 1 (its LaunchAgent pins
  `res:1920x1080 scaling:off`), so `clientWidth × devicePixelRatio === canvas.width` holds
  trivially and this host cannot falsify the drawing-buffer bug class. Only a real HiDPI Mac can.

Host diagnosis is repeatable: `gjsify run packages/framework/webgl/scripts/probe-gl-host.js`
(negotiated API/version, scale factor, logical-vs-device sizes, shader-dialect matrix, shader-free
pattern; exits non-zero when the GLArea does not realize). It needs a display, which is why it is a
script and not a spec — no CI runner here has one.

### `@gjsify/gamepad` on a platform without libmanette — OBSERVABILITY DONE, backend still missing

The observability half is closed. `packages/web/gamepad/src/backend.ts` is now the one place the
package decides whether a backend exists: `hasGamepadBackend()` (barrel-exported, answerable with no
monitor and no connected device, the `isSecureRandomSource()`/`hasNativeSab()`/`hasOcspSupport()`
pattern) and a SPLIT classification. The QUERY is silent and the diagnostic is emitted by the USE —
`GamepadManager._init()`, once per process — mirroring `isSecureRandomSource()` (pure) vs.
`fillRandomBytes()` (warns) in `@gjsify/webcrypto/random`; the recommended usage is to CALL the
predicate, so it must not cost a stderr line on every macOS/Windows start. Three outcomes, three
voices: **absent** = no `Manette` typelib, or no `@gjsify/node-gi` in a `--app node` process (a
supported configuration, so a warn naming what to install — not a fault), or `gi://` stubbed by
design on the `--app browser`/`--app nativescript` builds (nothing to install ⇒ SILENT, and on those
targets the runtime's own `navigator.getGamepads` is the implementation anyway); **fault** = a
library that will not `dlopen`, a version or ABI skew (`console.error` carrying the original);
**monitor fault** = everything past the probe (`new Monitor()`, the device walk, `connect()`) failing
on a host whose backend loaded fine — a sandbox without udev / `/dev/input` — which gets its own
report rather than being labelled a failed load.

`getGamepads()` answers the spec's `[[gamepads]]` and MUST NOT be made to throw: the list "is
initially the empty list" and grows only when an index is selected for a connected device, so a host
with no backend gets `[]` — the W3C steps only ever return a list (their one throw is the
`"gamepad"` permission-policy `SecurityError`), and a browser on a driverless machine answers
identically: WebKit compiles `EmptyGamepadProvider::platformGamepads()` returning a static empty
vector. Throwing would break `navigator.getGamepads().length`. The pre-filled four-slot array this
package used to return was CHROME's shape, and that is measured rather than assumed — one machine,
`about:blank`, no controller attached: Firefox `[]` (length 0) vs. Chromium `[null,null,null,null]`
(length 4). WebKit agrees with Firefox in source: `NavigatorGamepad::gamepads()` returns
`m_gamepads` unchanged when it `isEmpty()`. The four slots made `length` report four ports that do
not exist; they are gone.

The suite is runnable on a host with NO Manette typelib, and that is checked by running it there:
`bwrap --ro-bind / / --ro-bind <copy-of-girepository-1.0-minus-Manette> /usr/lib64/girepository-1.0
gjs -m test.gjs.mjs` → `138 completed`, identical to the same bundle on this machine WITH libmanette,
with the one-time "No gamepad backend on this host" line on stderr only in the first case. Keeping
that true is a constraint on the test bundle, not just on the source: `register.spec.ts` must not
reference `globalThis.GamepadEvent` / `globalThis.navigator`, because `--globals auto` reads those as
free globals and injects the GTK/GNOME-backed register set, which announces `gi://Gdk, gi://GdkPixbuf,
gi://Manette, gi://Pango, gi://PangoCairo at load`. Wiring an ad-hoc Manette-less CI leg is NOT
proposed here — the general answer is the per-namespace availability contract below.

Still measured, still true: no GTK-runtime bundle carries the Manette typelib or libmanette, so on
macOS and Windows that import has never succeeded. Deliberately NOT fixed by seeding libmanette into
the bundles. There is nothing to seed FROM: homebrew-core has no `libmanette` formula
(`formulae.brew.sh/api/formula/libmanette.json` → 404) and `GTK4_Gvsbuild_2026.6.0_x64.zip` contains
zero manette/evdev entries, so the seed pattern would match nothing and — with the typelib-symmetry
rule in place — a Manette typelib could not ship anyway. And a hypothetical port would not help:
libmanette's backend reads Linux `/dev/input/event*` via evdev/udev, so a `Manette.Monitor` on
macOS/Windows would enumerate nothing while satisfying every symmetry check. That is the same "looks
available, does nothing" shape, moved one layer down.

What is left is the BACKEND, and the generalisation. Same shape as the ten other namespaces the
workspace imports and no bundle ships (`gi://Gst` ×17, `gi://WebKit` ×4, `Soup`, `Gda`,
`JavaScriptCore`, `X`): the generalisable answer is a per-namespace availability contract — the
`backend.ts` probe (classify absent vs. broken, warn once, expose a `has*` capability) is the first
instance of it and is currently hand-rolled per package. The three concrete follow-ups are the next
three entries.

### A darwin gamepad backend is the only route to macOS support, and it is a separate project

`GameController.framework` alone is NOT sufficient, and the reference implementations both say so by
shipping two paths. WebKit's `Source/WebCore/platform/gamepad/` holds `cocoa/`
(`GameControllerGamepadProvider.mm`) AND `mac/` (`HIDGamepadProvider.mm`, plus per-device
`Dualshock3HIDGamepad` / `StadiaHIDGamepad` / `LogitechGamepad` / `GenericHIDGamepad`), combined by
`mac/MultiGamepadProvider.mm` — which calls `HIDGamepadProvider::ignoreGameControllerFrameworkDevices()`
and gates GCF on `GameControllerGamepadProvider::willHandleVendorAndProduct()`, a hardcoded
vendor/product allow-list. The comment that explains the allow-list is narrower than "GCF is too
aggressive" in general — verbatim, and note its first three words
(`cocoa/GameControllerGamepadProvider.mm:104`, inside
`#if HAVE(MULTIGAMEPADPROVIDER_SUPPORT) && !HAVE(GCCONTROLLER_HID_DEVICE_CHECK)`): *"On macOS 10.15,
we use GameController framework for some controllers, but it's much too aggressive in handling devices
it shouldn't. So we check Vendor/Product against an explicit allow-list to determine if we should let
GCF handle the device. (We have the opposite check in HIDGamepadProvider, as well)"*. So the
allow-list is the fallback for builds without the newer HID-device check, not a standing verdict on
GCF. The conclusion — a darwin backend needs BOTH paths — does not rest on that comment: it rests on
`mac/MultiGamepadProvider.mm` existing and driving both providers
(`HIDGamepadProvider::singleton().ignoreGameControllerFrameworkDevices()`), and on the per-device HID
classes next to it. SDL ships both paths too —
`src/joystick/apple/SDL_mfijoystick.m` (GameController/MFi) and
`src/joystick/darwin/SDL_iokitjoystick.c` (IOKit HID).

Second, larger piece of work: `packages/web/gamepad/src/button-mapping.ts` maps raw evdev codes
(`BTN_SOUTH: 304` … `BTN_DPAD_RIGHT: 547`, the kernel `linux/input-event-codes.h` constants
libmanette 0.2 actually transmits) to W3C indices. Nothing on macOS produces those numbers — GCF
gives named `GCControllerButtonInput` properties, IOKit gives HID usage pages — so a darwin backend
needs a SECOND source vocabulary mapped to the same `W3CButton`/`W3CAxis` targets, not a new row in
the existing table. `hasGamepadBackend()` returning `false` is the honest interim answer.

### libmanette is not portable and upstream has never considered it

Verified against `gitlab.gnome.org/GNOME/libmanette` (tag `0.2.13` and `main`):

- `meson.build` has `libevdev = dependency('libevdev', version: '>= 1.4.5')` and
  `hidapi = dependency('hidapi-hidraw')` — neither carries a `required:` argument, so both are hard.
  The only toggle in `meson_options.txt` under "Dependencies" is `gudev`.
- there is no `host_machine` conditional in ANY `meson.build` in either revision (checked all six in
  `0.2.13`, all of `main`).
- `hid_enumerate()` is never called anywhere in the tree. `manette-hid-backend.c` does
  `hid_open_path(self->filename)`, and `filename` comes from the monitor's gudev walk
  (`manette-monitor.c`: `g_udev_client_new({"input", "hidraw"})`,
  `g_udev_device_get_device_file()`, `DEV_DIRECTORY "/hidraw"` prefix test). So the hidapi backend
  only ever receives `/dev/hidraw*` paths a Linux-only monitor found — hidapi being cross-platform
  buys nothing.
- all 51 issues and 155 merge requests (GitLab API `x-total`, tracker open since 2017-12-03) scanned
  for macos / mac os / darwin / osx / portab* / windows / win32 / freebsd / cross-platform in title
  and description: **zero relevant hits** in nine years (the one keyword match, MR !104, is a
  comment about SDL button mappings).

And the dependency it hard-requires is not available: homebrew-core's `libevdev` formula carries
`depends_on :linux` with `arm64_linux`/`x86_64_linux` bottles only, MacPorts has no `libevdev` port
(ports API exact-name query → `{"count":0}`), and nixpkgs declares
`platforms = lib.platforms.linux ++ lib.platforms.freebsd`. Porting libmanette is therefore a
libevdev port first; that is why the darwin work above is a NEW backend, not a build fix.

### A forced migration is coming: `Manette-1`

libmanette `main` is `version: '1.0.alpha'` with `libmanette_api_version = '1'`, i.e. the typelib
becomes `Manette-1` and `@gjsify/gamepad`'s current `gi://Manette` (0.2) namespace is a different
one. The API is not source-compatible:

- `ManetteEvent` is DELETED (`src/manette-event.c` + `manette-event-private.h` removed in commit
  `3255105` "Remove ManetteEvent", part of MR !126 "Bump API version and revamp API", merged
  2025-04-01). Every `event.get_button()` / `get_absolute()` / `get_hat()` call in
  `gamepad-manager.ts` goes away with it.
- the device signals are renamed and re-typed: `button-pressed` / `button-released` /
  `absolute-axis-changed` (plus `unmapped-*` variants) instead of
  `button-press-event` / `button-release-event` / `absolute-axis-event` / `hat-axis-event`.
- typed `ManetteButton` / `ManetteAxis` enums (`src/manette-inputs.h`,
  `MANETTE_BUTTON_DPAD_UP` … `MANETTE_BUTTON_TOUCHPAD`, `MANETTE_AXIS_LEFT_X` …
  `MANETTE_AXIS_RIGHT_TRIGGER`) replace the raw kernel codes — which is exactly what
  `button-mapping.ts`'s `LinuxButton` table exists to decode, so that table is retired rather than
  extended. Note there is no `hat-axis` signal any more: the d-pad is four buttons.

`@girs/manette-0.2` does not bind the `Manette-1` namespace, so this needs a `ts-for-gir` run for the
new version before any code change. Independent of the macOS work above and independent of the
observability fix already landed: the migration is required on Linux the moment distros ship 1.0.

### The GTK-runtime bundle precedence question is still open

`resolveGtkRuntimeBundle()` probes four candidates in order (`GJSIFY_GTK_RUNTIME`, node-gi's own
`prebuilds/<target>/gtk/`, the sibling monorepo dir, then `require.resolve('@gjsify/gtk-runtime-<target>')`),
and an INSTALLED bundle satisfying candidate 4 is why the bundles must NOT be dependencies of
`@gjsify/node-gi`: #910 made the arm64 bundle a dependency and #920 reverted it, because a job that
built the addon against Homebrew GTK then re-execs onto the BUNDLE's typelibs with native code
linked against a DIFFERENT GTK — wrong method entries, then a 29-minute timeout. The same trap now
applies to a second darwin arch. What is missing is a rule that makes the mismatch VISIBLE rather
than a timeout: the bundle's `manifest.json` records its build prefix and dylib set, and the addon's
`otool -L`/`LC_RPATH` records what it linked against, so a load-time check could refuse the
combination outright. Until then the answer is the install-time one — the bundles stay manual
installs, documented in node-gi's README.

### `os.cpus().times` on darwin needs a Mach call GJS cannot make

`@gjsify/os`'s darwin reader reports the documented all-zero `times` — every field present and numeric, none of them meaningful — and `package.json#gjsify.os.darwin` is `"partial"` with that as its printed reason. Linux reads the per-CPU tick counters from `/proc/stat`. The macOS equivalent is Mach's `host_processor_info(PROCESSOR_CPU_LOAD_INFO)`, the same call libuv makes, and it is unreachable from GJS without a native bridge; no userland tool prints the cumulative per-core totals Node returns (`top -l 1` and `iostat` give an INSTANTANEOUS aggregate percentage, which is a different quantity — deriving one from the other would be fabrication, not degradation). Closing it means a native bridge, so it is a scope decision rather than a task. `src/index.spec.ts` carries `it.failing('cpu times should have non-zero values', …, { when: isDarwin() && gjs })`, which runs the assertion and fails the day a reader exists — so this entry retires itself rather than needing to be remembered.

### Two copies of the process-memory reader, and the `@gjsify/v8` node slot is why

`@gjsify/utils/core`'s `host-process` module and `@gjsify/v8`'s `heap/{linux,darwin,win32}.ts` read the same figures from the same sources with the same degraded contract (`ps(1)` has no data/peak column, so both report `0` there). The lift was made and REVERTED, and the reason is worth having written down before someone makes it again: routing v8's reads through `/core` removes the last `@girs/*` value import from that package, `audit-runtimes --check` then derives `runtimes.node: "native"` from the source signals instead of the declared `"none"`, and `Detect runtime-triplet drift` is one of the three checks that block a merge. Promoting the slot is a change to published ADR-0014 routing (a `native` slot sends the package root to `<pkg>/globals`, which `@gjsify/v8` does not ship), not a comment. So the question to answer FIRST is what `@gjsify/v8`'s node slot should be — `none` (this package does not serve Node) or `native` (Node has its own `node:v8`) — and the deduplication follows from it. Both files name the shared contract so it cannot drift silently in the meantime.

### A loopback teardown race survives on darwin, on the native-Node leg only

`@gjsify/net`'s `server.spec.ts` still reports 1-2 of 381 failing under NATIVE Node on darwin (`read ECONNRESET`), against 381 green under GJS on the same host. It was 2-4 before `withServer` took ownership of the accepted sockets and the affected specs learned to tolerate exactly `ECONNRESET`, so what is left is narrower, not closed. The mechanism is the kernel's: BSD resets a connection that is closed while unread data is buffered where Linux delivers a FIN, and an `'error'` event with no listener is re-thrown. The remaining failures wander between `close event after end` and `localPort after connect`, which is the signature of a socket outliving the spec that made it — the next thing to try is owning the CLIENT sockets' lifecycle the way the server's now is. Per this repo's testing rules a native-Node failure is a statement about the TEST, and our implementation is the one that is green.

### `@gjsify/sqlite`'s GJS suite ABORTS the process, and the trigger is a GC window

Not a failing assertion — `SIGABRT`. Measured on darwin-x64 / gjs 1.88.1 / libgda 6.0, running `database-sync.spec.ts` alone under the real harness:

```
DatabaseSync.prototype.close()
GLib-GObject:ERROR:../gobject/gobject.c:6103:_weak_ref_set:
  assertion failed: (weak_ref_data_list_find (new_wrdata, weak_ref) < 0)
Bail out!   gjs exited with code null
```

It stayed invisible until the `/var` vs `/private/var` fix landed, because the node leg failed first and the `&&` chain never reached the gjs one.

**Ruled out, each by measurement rather than by reading:** bare libgda (`Gda.Connection.new_from_string` + `open()` + `close()`, nothing of ours in the process) does not abort · leaked connections plus an explicit `system.gc()` do not abort · the same operations driven through the real `DatabaseSync` API outside the harness do not abort · a specific test is not responsible, and neither is a leaked connection from the constructor block — the constructor validates (`parsePath`, `validateOptions`) BEFORE it opens, so a throwing construction never creates one.

**What the bisect says.** Keeping the first N `it()` rows of the constructor block and rebuilding: N=0 ok, **N=1 CRASH**, N=2 ok, N=3 ok, **N=11 CRASH**. Non-monotonic — the number of preceding rows perturbs *when* the collector runs relative to the libgda objects' lifetimes, and nothing more. That is the signature of a GC window in the interaction between GJS's object-wrapper machinery (toggle refs / `GWeakRef`) and libgda's objects, not of a condition in our code. It is therefore NOT fixable by editing a spec, and a fix that appeared to work by adding or removing a test row would be luck.

Next step is instrumentation, not more bisecting: run under `GJS_DEBUG_ALL`/`G_DEBUG=fatal-warnings` with a breakpoint on `_weak_ref_set` to see which object is being re-registered, and whether the second registration comes from GJS's wrapper or from libgda. If it is GJS's, this joins the libgda row already in `upstream-patch-candidates.md`; if it is ours, the owner is `DatabaseSync`'s lifecycle. Until then there is no workaround to maintain, which is why this is here and not in that table.

### Two packages have no darwin target at all, and their specs say so by failing

`@gjsify/webrtc` dies at `Requiring GjsifyWebrtc … Typelib file for namespace 'GjsifyWebrtc' not found` and `@gjsify/sab-native`'s positive control `hasNativeSab() returns true when prebuild is loaded` cannot pass, because no `webrtc-native-darwin-*` package exists and `@gjsify/sab-native`'s `gjsify.platforms` declares `linux-*` only. Both are honest failures of a promise nobody made — the declarations are correct and the artifacts genuinely do not exist. Recorded so a macOS run's red is READ correctly: it is a missing target, not a broken port. Closing either means adding the darwin legs to `prebuilds.yml` and the targets to the manifests, at which point the same specs become the check. The sibling bridges (`http2-native`, `tls-native`, `terminal-native`, `http-soup-bridge`, `webgl`, `lightningcss-native`, `oxfmt-native`, `rolldown-native`) all already ship `*-darwin-{x64,arm64}`, so the pattern is proven — these two were simply never extended.
### `@gjsify/webkit-native` — what the darwin WebKit backend still owes

ADR 0022 landed the backend and `@gjsify/iframe`'s 291 tests pass on darwin. **Input forwarding, named script worlds and user-script allow/block lists have since landed too**, and the two entries that stood here for the latter pair were not deferrals but MISTAKES OF FACT — the ADR asserted "WKWebView has no public isolated-world API" when `WKContentWorld` has been public since macOS 11, and it warned-and-ran a script whose allow/block list said not to. Both are worth remembering as a shape: an Apple API that looks absent deserves a check of its availability annotation before a design is built around its absence. What remains:

**`darwin-arm64` is built on every `ci:macos` run and has never been committed, and the authoring host was never the reason.** `prebuilds.yml` built and uploaded the artifact from the day ADR 0022 landed, but `commit-prebuilds` had no matching download step, so every arm64 binary it produced was discarded — the `platformsUncommitted` note blaming an Intel VM was wrong about its own cause. The download exists now; closing this is one `ci:macos`-labelled run reaching `main`. The same PR is why the darwin-x64 artifact was refreshed: the shim now declares `-mmacosx-version-min=11.0`, so the committed binary's `LC_BUILD_VERSION` changed.

**The namespace is squatted, and one host shape gets it wrong.** The shim's typelib IS `WebKit-6.0` (ADR 0022 decision 3, with the measurement that forced it). On a macOS host that built WebKitGTK 6.0 from source, two providers would compete on `GI_TYPELIB_PATH` and ours — a subset — could shadow the real one, where a missing class reads as `undefined` rather than as an error. Bounded today by the artifact shipping only in an `os: ["darwin"]` package and by macOS having no packaged provider; if that ever changes, the fix is a synchronous backend selector in `@gjsify/iframe`, which GJS does not currently offer in a form this repo permits.

**Three things the input work reached the end of the public API on, all measured rather than assumed** (`docs/poc/webkit-input-darwin.m` prints each): `document.hasFocus()` is permanently `false`, so `window.onfocus`/`onblur` never fire and no caret blinks — it is derived from a responder chain the windowless view has no place in, and an offscreen `NSWindow` was built and does NOT fix it. The pointer cursor never changes over links, for the same reason. And App Sandbox stays unanswered: `webkit-hardened-runtime-darwin.sh` shows the hardened runtime working with `com.apple.security.cs.allow-jit`, while the sandbox case dies at process start because `com.apple.security.app-sandbox` needs a bundled app with an `application-identifier` an ad-hoc signature cannot issue. Answering it needs a real Developer ID, not more code.

**The input path has no CI coverage on any platform, and that is the honest state.** It is held by two by-hand probes — `webkit-input-darwin.m` (NSEvent → WebKit → page) and `webkit-input-widget-darwin.m` (the widget's own controllers → page, driven by emitting the controller signals). Both need a display, which is the same wall as the DISPLAY-gated-GTK entry above, and `@gjsify/iframe`'s 291 unit tests instantiate no live WebView at all. Two routes into GTK's real event translation were tried and are dead ends worth not re-trying: `-[NSApplication postEvent:atStart:]` is never picked up (GTK4's macOS backend does not drain the posted-event queue — measured with a plain `GtkGestureClick` and no WebKit anywhere, 0 hits), and `CGEventPostToPid()` is dropped because `AXIsProcessTrusted()` is false and Accessibility is not a permission CI can grant itself.

### `@gjsify/rolldown-native` macOS prebuild — the last step to a Node-free toolchain on macOS

The Rust blocker is GONE (eventfd descriptors → portable anonymous pipes in `src/rust/src/wakeup.rs`; `cargo check --target aarch64-apple-darwin` green) and `meson.build` is darwin-ready — but no NATIVE macOS build has been promoted: run the manual-dispatch `build-prebuilds-macos-experimental` job, promote the package into the REQUIRED `build-prebuilds-macos` job, add `darwin-arm64` to `package.json#gjsify.platforms`, and commit the prebuild. Until that leg is green the docs must keep describing the Node-free toolchain as Linux-only. The CLI-side loading follow-ups are DONE (`detectNativePackages()` resolves `<os>-<arch>` for the running host; `buildNativeEnv()` emits the loader variable the host actually reads). Only the artifact itself is missing. (See also the CI coverage item above — the darwin leg is proven, not promoted.)

### Follow-up — adwaita-web style isolation (ADR 0010)

The style-isolation boundary reset (`scss/_reset.scss`) landed. Remaining: document the `--adw-*` / `--*` token set as the public theming contract on the website (the sanctioned external-override API — the counterpart to the isolation); if a second light-DOM Adwaita renderer ever appears, lift the boundary reset into `@gjsify/adwaita-core` (headless) so both share it; keep `$adw-components` in `_reset.scss` in sync with `src/elements/*` (guarded by `style-isolation.spec.ts`). Shadow DOM stays a documented FUTURE option, not adopted.

### Follow-up — adopt `@gjsify/adwaita-app` in the shell consumers (ADR 0009)

Adoption is opportunistic, not a rewrite — wire each consumer onto the shell package on its next shell touch: `@gjsify/storybook` (re-base `StorybookApplication` onto `AdwaitaApp`/`runAdwaitaApp`), buchhaltung (`app/src/frontends/desktop` — replace its hand-rolled application/nav/loadIntoStack/toast/dialog code; follows the release train), eco-retrofit (`cli/src/app` — same; also fixes its latent `Adw.Application.run(null)` → `runAsync()` hang class).

### Stale PixelRPG maker bundle — rebuild + recommit with `installDevtools`

`@gjsify/devtools` exports `org.gjsify.Devtools` correctly in every app config (verified rigorously, guarded by `tests/e2e/devtools-export`), and the css-as-string bare-`@import` gap that blocked the maker's rebuild under the global GJS CLI is fixed at the core (native `bundle()` path resolves + inlines bare-specifier `@import`s via `cssBundleResolver`; unresolvable imports fail loudly; `tests/e2e/css-as-string-bare-import`). Residual (map-editor repo, not gjsify): the committed `apps/maker-gjs/org.pixelrpg.maker` bundle predates the `installDevtools(this)` call — rebuild + recommit it. `installDevtools` logs `[gjsify-devtools] exported …` so "did devtools come up?" is answerable from the app's stderr.

### `Screenshot`'s `scope` in-arg is DEAD — a caller asking for a widget silently gets the active window

The wire method takes one (`<arg type="s" direction="in" name="scope"/>`,
`packages/framework/devtools/src/devtools-iface.ts:11`) and the handler ignores
it: `ScreenshotAsync(_params, invocation)`
(`packages/framework/devtools/src/devtools-service.ts:151`) always calls
`_captureActiveWindowPng()` (`:171`), which resolves
`this._app.get_active_window()` and nothing else. The generic MCP tool passes
`scope ?? 'window'` (`packages/framework/devtools-mcp/src/generic-tools.ts:62`),
so every caller today happens to ask for the active window and the gap stays
invisible — but `'toplevel:1'` or `'toplevel:0/child:2'` returns the active
window's pixels: a WRONG ANSWER, not an error.

Both halves of the fix already exist: `_resolveRootWidget`
(`devtools-service.ts:289`) already maps `''`/`'window'`/`'active'` AND any
widget path, and `captureWidgetPng(widget)` (`screenshot.ts:18`) captures any
widget — `_captureActiveWindowPng` is the one path that goes through neither. The
warm-up retry (`captureWidgetWhenRenderable`) is widget-generic too. Deliberately
not fixed alongside the bus-less transport: it changes what an EXISTING argument
MEANS, so it wants its own regression test per scope shape (active window, a
non-active toplevel, a child widget, and an unresolvable path → error rather than
a silent fallback).

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

### N-API host in GJS (`@gjsify/napi`) — Phase 2+ follow-ups

Phase 0 (full `js_native_api.h` + module loader; better-sqlite3 byte-identical to Node, valgrind-clean; conformance 13 pass / 8 ledgered / 0 fail) and Phase 1 (tsfn surface; node-gi-under-shim byte-identical to native `gi://` across all 21 conformance programs — a CI test oracle, NOT a production path) are complete; the transparent `.node`→`loadAddon` build integration has shipped (`napiNodeAddonPlugin`, e2e-gated byte-vs-Node on all four addon-loading conventions). Open:

- **implement the deferred non-experimental stubs** — `napi_*_bigint_words`, `node_api_create_external_string_{latin1,utf16}`, `napi_create_external_arraybuffer` (currently loud stubs → several of the 8 ledgered conformance programs).
- **crash-class hardening (deferred, non-blocking)** — null `state->wrap` via a back-pointer to close a theoretical teardown-finalizer sibling-unwrap UAF; Node-parity, not a graduation gate.
- **the 4 `NAPI_EXPERIMENTAL` conformance addons** — `node_api_post_finalizer` / `node_api_create_object_with_properties` / `node_api_is_sharedarraybuffer`.
- **node-gyp golden drift watch** — the node-gyp goldens were generated on Node 24 but CI runs Node 22; watch the first CI run for golden drift.
- **cross-platform prebuilds** — macOS darwin-arm64 SHIPPED incl. the tsfn gate (conformance/consumer/valgrind widening deferred; no maintained arm64-macOS valgrind). **Windows (win32-x64): ATTEMPTED, blocked at gjs-on-Windows** — shim-side portability is done and Linux-verified (`.def` exports, `LoadLibraryEx` loader, manual-dispatch `windows` job); a prebuilt MSVC mozjs-140 now exists (servo/mozjs `mozjs-sys-v140.13.0-0`), but no prebuilt libgjs exists for Windows and servo's patched static-lib layout is not the pkg-config `mozjs-140` gjs's meson consumes, so gjs must still be source-built (clang-cl) — and behind that waits the delay-load host-binding wall (no POSIX global symbol namespace; an unmodified node-gyp `.node` binds `napi_*` against the host `.exe`, which `gjs.exe` does not export). Unblocks when a prebuilt libgjs-win32 appears OR gjs builds against the servo mozjs AND the delay-load host-binding is solved.

### GI/GObject runtime for Node (Axis 5) — deferred limitations

`@gjsify/node-gi` graduated Tier 3→2 per ADR 0005 (2026-07-14) — the four gate items landed (teardown crash, vfunc OUT/INOUT, GTK/Cairo layer, second real consumer), the GIMarshallingTests oracle sits at 370 pass / 0 fail, the Excalibur-WebGL and Adwaita-window/storybook GTK capstones render byte-identically to `gjs -m`, and the cross-runtime legs (Bun full core parity, Deno conformance subset) ship from one N-API binary. The step-by-step roadmap provenance lives in git/CHANGELOG. Known gaps left for follow-up PRs (each surfaces a clear error or is benign; none is silently wrong):

- **Cross-runtime consumer survey — prioritized backlog.** `scripts/node-gi-consumer-harness.mjs` generalizes the consumer proof (a package's OWN GJS suite runs `--app node` on node/bun/deno); the `consumer-suites` CI job gates the proof set `sqlite`+`http2`+`zlib` under `--require-pass`. Full survey + gap report: `docs/reports/node-gi-consumer-survey.{md,json}` — 17 packages already run unchanged. Remaining blockers, priority order: **P3** — GLib/GObject marshalling-helper gaps (`ByteArray.fromGBytes`, `GLib.filename_from_uri` undefined; blocks `child_process`/`os`/`module`); **P4** — `normalizeEncoding`/`checkEncoding` unresolved when a polyfill is `--alias`ed onto Node (`crypto`/`string_decoder`). Follow-ups: full 22-package `test:gjs-on-node` rollout + a non-gating full-survey CI job that publishes the table.
- **Bun/Deno conformance is a curated subset, not the full suite.** Excluded from `test:bun`/`test:deno`: the display/GTK tests (CI Xvfb leg), the `--expose-gc` toggle-ref stress leg (Node's GC-safety gate), and the mainloop/runasync/pump uv-integration cases (they assert the Node-only libuv↔GLib bridges; Bun/Deno drive the non-blocking case via `startMainContextPump`, and `async-gio-await` is ledgered for them accordingly).
- **Reverse-bridge polyfill routing over runtime natives** — on Node the global `fetch` stays the NATIVE undici one (the register convention never overrides an existing native), so `@excaliburjs/plugin-tiled`'s fetch-based fileLoader cannot load the root-relative `/res/…` asset paths our GJS fetch/XHR resolve against the program dir. This is what blocks the FULL `excalibur-jelly-jumper` on `gjsify run --runtime node` — everything else boots. Needs an opt-in GJS-parity-globals mode for reverse-bridge builds (route `fetch`/friends to the `@gjsify/*` polyfills over the runtime natives).
- **Gst audio decode/playback on node-gi is PROVEN on node, bun and deno; the residual is the bun/deno pump requirement.** The former nondeterministic decodebin SEGFAULT was the `(transfer full)` GObject IN-arg ownership bug in `marshal.cc`, fixed; measured clean against PipeWire (a real sink-input owned by the runtime pid, 0 crashes/CRITICALs over repeated runs). The harness verdict: node `pass 62/62`, bun/deno `partial 61/62` — the one failure is `onended` not firing in a BARE script, the already-ledgered no-auto-pump property (`ended` rides a `Gst.Bus` watch on the GLib main context; with the context advancing it fires on bun and deno too). Deciding whether `@gjsify/webaudio` should drive the context itself (it cannot import node-gi — ADR 0005 forbids the hard dep) or whether bun/deno should gain node's auto-pump is a separate cut. No CI leg exercises this (needs a sound device); the harness is the reproducible check. Related test-harness fix already landed: `@gjsify/webaudio`'s `test.mts` awaited the spec directly instead of routing through `@gjsify/unit`'s `run()`, so a broken assertion still exited 0 — the same shape is worth checking on any package whose `test.mts` does not call `run()`.
- **`@gjsify/xmlhttprequest` — on DENO every XHR stalls at `readyState 3`, so an asset loader never completes.** Reproduced on the jelly-jumper showcase (`--app node`, `--runtime deno`): all 26 resource requests reach readyState 3 within 10 ms and then NOTHING — no readyState 4, no load/error events, for the whole run. **Bun runs the identical bundle to completion**, so this is deno-specific. Ruled out by measurement (do not re-investigate): GLib sources fire, microtasks drain inside the blocking `Adw.Application.run()`, `Gio.File.load_contents_async` completes, and the two primitives `readFileUrl()` is built from return correct bytes on deno. The stall is inside `send()`'s `Promise.resolve().then(doFetch)` chain and needs instrumentation INSIDE `@gjsify/xmlhttprequest` (its `__GJSIFY_DEBUG_XHR` logs go through `console.log`, which the `--app node` bundle routes somewhere the terminal does not see — fixing that visibility is step one).
- **vfunc chain-up** — OUT/INOUT args supported; the remaining gap is multi-level JS-override chains (a registered subclass of a registered subclass), rejected with a clear error. INOUT *container* args stay deferred (a catchable throw, like the function path).
- **struct gaps** — struct *construction* (`new Ns.Struct({…})`), array-of-struct-by-value element field reads, and GValue BLOB (byte-array) marshalling (surfaced by the sqlite consumer — a bound `Uint8Array` doesn't persist and a BLOB return comes back as a raw boxed handle).
- **`worker.terminate()` mid-native-call** — the `Error::New` `SIGABRT` funnel is CLOSED (every fallible chain checks the swallowed-failure residue; stress: 0 aborts / 200 terminates on both loop shapes, guarded by `test/worker-terminate.test.mjs`). RESIDUAL: a lower-rate SIGSEGV (12/200 ≈ 6%, identical pre-fix) when the terminate lands while the worker OS thread is inside a blocking GLib C call — the terminating isolate racing an OS thread in native code, with no napi frame; pre-existing, the textbook "terminating a worker mid-native-call is documented-hazardous in Node generally" case. Closing it would need Node/V8 to quiesce in-flight native calls before freeing the worker isolate.

### child_process instant-exit pid — upstream GIO gap (issue #503; rewrite scoped + rejected)

`@gjsify/child_process`'s `spawn()`/`exec` read `child.pid` from `Gio.Subprocess.get_identifier()`, which returns `null` once GSubprocess's child-watch (GLib worker-thread context) reaps the child — so an instant-exit child on a saturated runner can lose its pid (Node always reports one). **Resolved at the test layer** (deterministic alive-when-checked process) + **documented as an upstream GIO limitation** (see Upstream GJS Patch Candidates). The `GLib.spawn_async_with_pipes_and_fds` + `DO_NOT_REAP_CHILD` rewrite was scoped and **rejected for now**: it regresses `child.kill()` to a `/bin/kill` shell-out and reimplements env/cwd/stdio/wait-status reaping on a critical path. Revisit IF: (a) a real consumer needs a reliable pid for instant-exit children, or (b) upstream GIO exposes a spawn-time pid. **Filed upstream: [GNOME/glib#3981](https://gitlab.gnome.org/GNOME/glib/-/work_items/3981)**; maintainer verdict: accessor "would be OK" but de-prioritised in favour of pidfds, so the deterministic alive-process test + spawn-time capture (`_capturePidAtSpawn`) is our stable, permanent posture, not a temporary workaround.

### `spawn(process.execPath, [cliBin, …])` under the GJS bundle (showcase.ts)

`showcase.ts` spawns `spawn(process.execPath, [cliBin, 'dlx', dlxSpec])` — the same `process.execPath`-is-the-bundle trap fixed in `spawnOxcLauncher`. Under the committed GJS bundle `process.execPath` is `gjs`/the `.mjs`, not `node`, so `gjsify showcase <name>` under the GJS bundle spawns the wrong interpreter. Two-part fix (mirror `spawnOxcLauncher`): resolve the launcher via `nodeBinary()`, and use the blocking spawn path under GJS (a command that returns normally must not rely on the async exit event — see AGENTS.md § Lint & format). The deeper root — making async `@gjsify/child_process` spawns usable from CLI commands that return normally — is worth a dedicated fix (would also unblock spawn-based `gjsify test` under GJS).

### `@gjsify/sqlite` exec() compound-statement (CREATE TRIGGER) splitting

`DatabaseSync.prototype.exec()`'s `#splitStatements()` is comment/quote-aware, but still a token-level scanner, not a parser — a compound statement whose body carries inner semicolons is shattered: `CREATE TRIGGER t … BEGIN INSERT …; … END;` splits at the `;` after the inner `INSERT`, yielding `incomplete input`. node:sqlite gets this right because SQLite's real parser knows `BEGIN…END`. **Clean fix = let libgda's own statement tokenizer do the splitting** — currently blocked because `Gda.SqlParser.parse_string()` used iteratively hits a double-free under GJS and `parse_string_as_batch()` returns `Gda.Batch` objects rather than `Gda.Statement`s. A heuristic port of SQLite's `sqlite3_complete()` state machine was considered and NOT taken (mis-handles `CASE…END;`, adds risk to the transaction `BEGIN; … COMMIT;` path). Revisit when the libgda `parse_string` limitation is resolved (then the hand-rolled splitter can be retired entirely).

### oxlint native path — deferred (JS-plugin host needs Node)

`gjsify lint` still spawns the npm `oxlint` Node launcher even under GJS. A `@gjsify/oxlint-native` GI bridge (mirroring `@gjsify/oxfmt-native`) could only run the Rust rule subset: the JS-plugin host that executes `.oxlintrc.json` `jsPlugins` (the internal `gjsify/register-class-order` rule) lives in the Node launcher, so a native lint would silently skip that rule — a worse failure mode than requiring Node. Options when picked up: (a) native lint as an explicit opt-in subset (`GJSIFY_OXLINT=native`, warn when jsPlugins are configured); (b) port `register-class-order` to a Rust rule upstream; (c) wait for oxlint's plugin host to become embeddable without Node. Until then: `gjsify format`/`fix`'s oxfmt half is Node-free under GJS, `gjsify lint` (and the oxlint half of `fix`) needs Node.

### gjsify on Flatpak — remaining roadmap

The `org.freedesktop.Sdk.Extension.gjsify` SDK extension (toolchain under `/usr/lib/sdk/gjsify`, no network and no Node at app-build time, x86_64 + aarch64, `gjsify-tsc` included, e2e-gated incl. a real `flatpak-builder` tier) and the Node-free self-build (the committed GJS bundle rebuilds the CLI itself via native rolldown; e2e `tests/e2e/self-host`) have both landed. Open:

- **Flathub-grade offline-sources build** — vendor via `gjsify flatpak sources` instead of `../` file paths; only needed for an actual Flathub submission, which is itself gated on Flathub's Generative-AI policy (extensions/runtimes are in scope → discretionary "mature, well-maintained" exception; a gjsify-owned OSTree remote sidesteps it).
- **Remaining Node touchpoints for a FULLY Node-free self-build** — oxc lint (oxlint's JS-plugin host needs Node — see the oxlint entry above) + switching the build-orchestrator entry from the Node CLI to `gjs -m cli.gjs.mjs`.
- **`gjsify install --offline`** — a fail-fast-on-cache-miss flag so a no-network sandbox install errors clearly instead of attempting (and slowly failing) a network fetch. Complements `gjsify flatpak sources`.

### Upstream PRs in flight (NativeScript) — track until merged

Two fixes contributed upstream so NS apps work without gjsify-side workarounds. **Both OPEN as of 2026-06-04.** Revisit when either merges + ships in a NativeScript release: drop the corresponding workaround, then bump the version floor / re-validate.

| PR | Fixes | Our interim workaround | Drop when merged + released |
|---|---|---|---|
| [NativeScript/NativeScript#11259](https://github.com/NativeScript/NativeScript/pull/11259) — `fix(vite): support Vite 8 / Rolldown` | `@nativescript/vite`'s function-replacement `resolve.alias` + `@rollup/plugin-commonjs` that Vite 8 / Rolldown reject | `@gjsify/nativescript-vite`'s `applyVite8Fixes()` drops both at compose time | When `@nativescript/vite` ships Vite-8 support, `applyVite8Fixes` can shrink to (or drop) the two fixes — gate on the `@nativescript/vite` version |
| [NativeScript/nativescript-cli#6056](https://github.com/NativeScript/nativescript-cli/pull/6056) — `fix(bundler): copy the vite bundle to native in non-watch builds` | NS CLI copies the Vite bundle into the APK only in watch mode; `ns build` / `ns run --justlaunch` leave `assets/app` empty → SBG fails | `tests/integration/nativescript/scripts/run-on-device.mjs` does `ns prepare` → manual copy → `gradle assembleDebug` | When the fixed NS CLI ships, the runner can use plain `ns build` / `ns run --justlaunch` again |

Check status: `gh pr view 11259 --repo NativeScript/NativeScript --json state` / `gh pr view 6056 --repo NativeScript/nativescript-cli --json state`. No CLA required on either repo; both are auto-reviewed by CodeRabbit — address only blocking findings.

### NativeScript apps that pull web-API third-party deps — eval-time global injection (Welle 5 follow-up)

On-device teapot re-validation confirmed the css-tree fix, but the teapot still does not render on NS V8: its third-party deps (`@nativescript/canvas-polyfill`, `@xmldom/xmldom`, `three`) instantiate web globals at module-evaluation time (`new TextEncoder()` / `new XMLHttpRequest()` / `new FileReader()` at top level) and NS V8 doesn't provide those globals that early. The same class as the `@gjsify/buffer` eager-`TextEncoder` bug, but in deps gjsify doesn't own. The gjsify-side fix is a composer feature: inject/seed the web-API globals (or hoist canvas-polyfill's registration) at the very top of the NS bundle, before any module evaluates — analogous to the GJS `process-stub` `renderChunk` prepend. Design open (which globals; seed-from-`@gjsify/web-*` vs hoist canvas-polyfill; `optimizeDeps`/`renderChunk` prepend). Until then, NS apps whose dependency graph instantiates web globals at eval time (canvas/WebGL/three.js stacks) build but crash on launch; headless logic packages run fine. Related open items:

- **NS CLI 9.0.6 Vite bundle-copy is watch-mode-only** — `compileWithoutWatch` never calls `copyViteBundleToNative`; the smoke runner works around it (manual copy after `ns prepare`); the real fix is the upstream NS-CLI PR above.
- **iOS smoke test** — only Android was validated on-device; the platform path is symmetric (`.ios` extensions, `__IOS__`/`__APPLE__` defines) but unproven; add an iOS build smoke test when a macOS runner is available.
- **Conditional-export precedence** — `resolve.conditions` keep upstream's `browser` active alongside `nativescript`; a package with divergent `browser` vs `nativescript` conditional exports may resolve its `browser` variant. Decide a policy (drop `browser` for NS, or document) + add a regression test.
- **Worker builds** — the upstream `worker` config is passed through verbatim; gjsify transforms are not propagated into `worker.plugins`. Validate + propagate when a worker-using NS showcase lands.
- **Full ownership (Level 3)** — the composer keeps `@nativescript/vite` as an optional peer. Owning the NS-runtime plugins outright remains the larger goal — gated on whether the peer proves a maintenance burden + the upstream NS-CLI pluggable-`bundler` PR.

### NativeScript pillar coverage (Welle 5+, parallel implementations)

The slot backfill (all 80 declarable packages), `@gjsify/native-fs-bridge`, the `@gjsify/crypto` NS entry and the on-device integration suite have landed. Remaining Wellen (each a separate PR/worktree):

- **Welle 5-D — `@gjsify/stream` + `@gjsify/http`-client** (M): client-side over NS' native `fetch()`; server-side (`createServer` etc.) throws ENOTSUP; `runtimes.nativescript: 'partial'`.
- **Welle 5-F — extend `tests/integration/nativescript/`** per pillar as 5-D lands (CI runner may need a privileged container for the NS emulator stack).
- **Welle 5-G — `gjsify create-app --template nativescript-*`** (M): mobile-app scaffold templates. Adwaita-feel-on-mobile is an open design question — could use NS' native UI with gjsify polyfills providing the data layer.

### NativeScript build-feature ownership — Level 3 (gjsify as a first-class NS production bundler)

Level 2 (platform file resolution + platform defines) is owned by gjsify. **Level 3 (north-star, L, multi-week):** make `gjsify build --app nativescript` (or the Vite preset) produce a standalone NS-loadable production bundle, replacing `@nativescript/{webpack,vite}` for the JS-bundling step. The NS-runtime subset still to replicate: main-entry + bundle-emit to NS's expected dist layout (≈150 LOC sans HMR), static-copy of `App_Resources`/fonts/assets, the `@NativeClass()` transform (≈43 LOC), optionally app-components/XML page registration (≈278 LOC — skippable for code-only canvas apps) + CSS/theme-core. HMR is the bulk of `@nativescript/vite`'s complexity and is NOT needed to ship (production-only target). **Hard blocker:** NS's CLI bundler dispatch is a hardcoded `webpack|rspack|vite` switch — `bundler: 'gjsify'` needs an upstream NS-CLI PR for a pluggable bundler, OR gjsify masquerades under the `vite` name (current Level-1 path). The spawn contract is discoverable (`node <bundler>/bin build --config=<path>`, `NATIVESCRIPT_BUNDLER_ENV` JSON env, dist copied into APK assets).

### Website & docs follow-ups

Collected user-tracked items — every one turns existing engineering work into something visible / measurable for users.

- **Test + extend the new showcases, then embed them on the website.** Each showcase needs: (1) a manual smoke-test on GJS (`gjsify showcase <name>` end-to-end), (2) gaps turned into fixes or tracked follow-ups, (3) a `website/src/content/docs/showcases/<name>.mdx` page embedding the browser entry for live demo + describing the GJS counterpart.
- **Bridge widgets docs on website.** `@gjsify/canvas2d` / `@gjsify/webgl` / `@gjsify/iframe` / `@gjsify/video` are documented inline in AGENTS.md but there is no user-facing doc explaining the pairing matrix (DOM element ↔ Bridge class ↔ GTK widget) and the `installGlobals()`/`onReady()` lifecycle. Target one Astro page under `website/src/content/docs/framework/bridges.mdx` with a minimal worked example per bridge.
- **Web/Node compat as progress bars on the website.** The Summary table is consumed by `website/scripts/generate-coverage.mjs` → `src/data/coverage.ts`; extend the same treatment per package on the detail pages.
- **Ship `gjsify` and `ts-for-gir` themselves as Flathub CLI apps.** The `gjsify flatpak --cli-only` path already produces the right shape; take both CLIs through the full Flathub-submission flow (manifest in `flathub/<app-id>`, `flatpak-builder` validation, appstreamcli + `flatpak-builder-lint`, screenshots/release notes).

### WebGL deferred items (Workstream D)

- **Optional headless drawing-buffer pre-allocation.** `_init()` (`webgl-context-base.ts`) leaves the headless-gl-style `_allocateDrawingBuffer` call commented out because `GtkGLArea` owns the surface. Re-enable if/when a non-GTK output path is added.

### Flatpak helper subcommands — downstream adoption (PR3–PR6)

`gjsify flatpak {init,build,deps,ci}` and the bundler-side primitives they lean on have landed. Remaining downstream work: PR3 (ts-for-gir-cli adopts `defineFromPackageJson`), PR4 (app-gnome Vite → `gjsify build`), PR5 (app-gnome flatpak workflow on top of `gjsify flatpak`), PR6 (CLI-flatpak example docs page — the documented `org.gjsify.TsForGir` shape: GNOME Platform runtime + read-only `/usr/share/gir-1.0` mounts).

### TLS gaps that Gio does not surface (Workstream B follow-up)

Server-side SNI, session resumption and channel binding are resolved (see the `@gjsify/tls`/`tls-native` status entries). Remaining gaps map to GnuTLS/OpenSSL features Gio's GI bindings do not expose:

- **OCSP stapling.** Neither client- nor server-side OCSP is exposed by Gio (`gnutls_ocsp_status_request_*` has no GI binding), so `tls.connect({requestOCSP})` / the `'OCSPResponse'` event cannot be implemented end-to-end without a native bridge wiring `request_ocsp_status` into `Gio.TlsConnection`. Partial unblocker shipped: `@gjsify/tls-native` Phase 1 `parseOcspResponse(bytes)` (RFC 6960 DER parser), surfaced via `@gjsify/tls` with the `hasOcspSupport()` graceful-degradation gate — consumers can fetch OCSP responses themselves (e.g. via the cert's AIA responder URL) and validate status without bypassing Gio's TLS stack. The Gio-side `request_ocsp` wiring (responses arriving automatically over the handshake) stays open.
- **DH params / explicit ECDH curves / ticket-key rotation.** Gio does not expose `g_tls_server_connection_set_dh_params` or equivalent. Server tuning happens via `GIO_USE_TLS=gnutls` env at process level; not per-connection.

### SharedArrayBuffer constructor opt-in (Mozilla pref)

- **`SharedArrayBuffer` constructor is unavailable in stock GJS** (`typeof SharedArrayBuffer` is `undefined` on GJS 1.88): Mozilla disables it unless the SpiderMonkey embedder opts in, and GJS does not. Upstream patch candidate: enable the SharedMemory pref in `gjs/engine.cpp` + the matching `Atomics.wait`/`notify` capability bits. Workaround landed: `@gjsify/sab-native`'s `SharedBuffer` (method-accessor API + free-function `atomics` namespace over memfd/mmap/futex) does not require the constructor at all and is wired into `Worker.postMessage`.
- **Generic `ArrayBuffer` cross-process transferList.** `Worker.postMessage(value, transferList)` for a plain `ArrayBuffer` (not a `SharedBuffer`) still goes through JSON IPC and stays a deep-clone, not a zero-copy hand-off — the SCM_RIGHTS side-channel only carries memfd-backed regions; arbitrary ArrayBuffers would need a generic binary IPC frame format (or a SharedBuffer-as-ArrayBuffer wrapper the structured-clone layer recognises). Lower priority — SharedBuffer covers the high-bandwidth workloads.

Use `@gjsify/worker_threads` `MessageChannel` (in-process) for zero-copy / pure-`ArrayBuffer` workloads today; cross-process SharedBuffer for shared-memory workloads across subprocess workers.

### ts-for-gir — extend integration suite beyond Phase 4b

Strategic goal: `ts-for-gir` runs unmodified on GJS. Phases 1–9 have landed (see the integration-coverage notes). Remaining:

- **Phase 6 / gjsify run:** runtime npm-package resolution for GJS bundles (GJS has no node_modules resolver; would need a C-level patch).
- **Phase 8 / GVariant type-inference:** full port of `gvariant-validation.test.ts` — requires `@girs` ambient declarations resolvable by the TypeScript compiler.

`refs/ts-for-gir/` is pinned at the commit corresponding to `@gi.ts/parser@4.0.0-rc.9`; bump the submodule alongside the published-package version when porting future phases.

### Universal DOM Container (`@gjsify/dom-bridge`)

Architectural vision for unified DOM-in-GTK: `document.createElement("canvas")` + `getContext("2d")` automatically creates the right GTK widget behind the scenes; `document.body` maps to a real GTK container hierarchy; each child element gets its own bridge transparently — making browser code "just work" in GTK without explicit bridge creation. Deferred from the initial bridge architecture — requires deeper integration between `Document`, `Element.appendChild`, and the GTK widget tree.

### Autobahn — wire into CI

Full Autobahn suite (core + permessage-deflate + performance 9.\*) is part of the committed baseline. Remaining: (1) the `6.4.x` NON-STRICT fragmented-text timing needs an upstream libsoup change (fragment-level UTF-8 validation — see Upstream GJS Patch Candidates); (2) Podman-in-CI needs privileged containers (or socket sharing) the Fedora-based CI doesn't currently grant — until then the suite is a manual opt-in run + baseline-commit workflow. Plan: wire the autobahn scripts into a nightly CI job once Podman-in-CI is unblocked.

### Autobahn driver — `System.exit()` bypass in bundled driver context

`System.exit(0)` called from the bundled driver's `Promise.then` continuation silently returns without terminating the gjs process (the GLib main loop `ensureMainLoop()` starts for Soup keeps the process alive after `main()` resolves), even though the same call works from a standalone script or a MainLoop idle callback. `scripts/run-driver.mjs` compensates with a watchdog (waits for the `Done.` marker, 3 s grace, then SIGKILL — no data loss; the report is flushed before `Done.`). Next steps to remove it: isolate whether the block is in `@gjsify/process`'s `exit()` shim, the `globalThis.imports` patching, or an interaction with `@gjsify/node-globals/register`; write a minimal reproducer outside the Autobahn pillar; fix root-cause and inline `gjs -m dist/driver-*.gjs.mjs` back into the package scripts.

### `@gjsify/sqlite` — expand API surface

Libgda does not expose session/changeset, WAL-mode toggles, backup or VFS APIs, so those are open gaps beyond the current DatabaseSync/StatementSync coverage. The closest paths: (a) wrap sqlite3 directly via libsqlite3 GI bindings (expensive — no upstream GIR), or (b) live with the libgda-shaped subset and document the gaps per API. (b) is the current direction; `sqlite.constants` (SQLITE_CHANGESET_\*) remains unimplemented until (a).

### WebRTC showcases (extended)

`webrtc-loopback` is a published showcase. Open follow-ups: `webrtc-video` could be a second showcase (getUserMedia + media pipeline; needs camera-permission UX — separate workstream); `webrtc-dtmf` / `webrtc-states` / `webrtc-trickle-ice` remain private reference implementations for specific spec behaviors, not end-user showcases.

### Doc-revert detection — a non-conflicting revert of a `main`-only edit

`a9e5ba63d` (on the status-as-data branch) rewrote the AGENTS.md governance
block against a copy of the file that predated #885's consolidation. Git merged
it without a conflict, because "replace one line with five" is a legitimate edit
on a region the other side had already rewritten — the merge base simply had
neither version. The result silently restored ~5 duplicated paragraphs that #885
had removed, and nothing in the pipeline could see it: prose has no test, no
type, and no conformance rule.

The generalisable check is cheap and does not need to understand prose: for each
line a PR REMOVES, ask whether that exact line was ADDED to the base branch after
the PR's merge base. A hit means the PR is reverting work it never saw. Real
reverts and genuine rewrites both trip it, so it must be a warning with an
explicit acknowledgement path (a `Revert-Of:` trailer, or a label), never a hard
gate. Cheapest home: a step in the `check` job over `git diff --merge-base`,
scoped to `*.md` first, since prose is where the class actually bites — source
regressions of this shape are usually caught by tsc, lint or a test.

### The baked CI image is `linux/amd64` only, so three arm64 jobs still `dnf install` every run

`build-ci-image.yml` publishes `ghcr.io/gjsify/ci-fedora:<major>` for
`platforms: linux/amd64`, with the comment "When we add aarch64 runners we'll
grow this list". They were added. Three jobs run on `ubuntu-24.04-arm` —
`node-gi.yml/arm64`, `prebuilds.yml/build-prebuilds` (arm64 leg) and
`release.yml/node-gi-prebuild-linux` (arm64 leg) — and have no image to move to,
so each still pays a full `dnf install` from Docker Hub on every run. One of the
three is on the RELEASE path.

That cost is not hypothetical: during the v0.26.0 sweep `napi` failed outright
when `docker pull fedora:44` timed out against registry-1.docker.io three times
before the container existed, and the storybook bundle job was killed by its
45-minute timeout TWICE with ~41 of those minutes inside a single `dnf install`
— a step whose normal cost is 22 seconds. Neither failure had anything to do
with the code; the same commit was green on the PR.

The earlier version of this item claimed the switch needed a SECOND baked image
because "several of these jobs are minimal ON PURPOSE (the Node-free install
proof, 'no system GTK' conformance)". That premise was checked and is FALSE —
every one of them installs gjs and the GNOME devel set itself, and no job
asserts that a system library is absent. Ten of the thirteen have since switched
to the one image with no property lost.

Remaining work is therefore a single edit with a real cost attached: add
`linux/arm64` to that `platforms:` list. Building it under QEMU on an x64 runner
would be slow enough to matter for a weekly cron plus every Dockerfile PR, so
the shape worth measuring first is a native `ubuntu-24.04-arm` build leg joined
into one manifest. Nothing needs to be remembered afterwards:
`scripts/check-ci-image-packages.mjs` DERIVES the exemptions from the published
arch list, so widening it turns all three from "excused" into "must switch" on
the next run, and its hand-written ledger is already empty.

### Nothing byte-compares a committed prebuild, and macOS re-commits noise

AGENTS.md already records that committed `prebuilds/**` binaries are unguarded
(provenance proves the inputs; nothing compares the bytes). The v0.26.0 sweep
showed the other half of that gap: `commit-prebuilds` pushed six darwin-arm64
dylibs whose sizes were IDENTICAL to their predecessors (37144 -> 37144, and so
on) but whose bytes differed — non-reproducible Mach-O output (timestamps,
UUIDs). So every macOS prebuild run commits binary churn with no semantic
change, and that push moved `main` out from under an already-verified sweep
mid-release. Worth fixing at the source (reproducible flags) rather than by
suppressing the commit, since byte-reproducibility is what would let a future
check compare a committed prebuild against a CI-built one at all.

**Now measured to the byte, because the same non-reproducibility killed the
commit channel outright** (fixed separately, by removing the rebase — see the
sync script). Diffing two consecutive bot commits of unchanged sources
(`7f4e81291` -> `a03206649`): all **16** committed darwin dylibs changed, every
one at an identical size, and no linux `.so` changed at all — the ELF legs
reproduce exactly. Per file, on darwin-x64, EVERY differing byte is one of two
things: the 16-byte `LC_UUID` payload, and the `n_value` of the `N_OSO`
debug-map stabs, which is each intermediate object file's mtime (e.g.
`libgjsifytls.dylib`: 25 of 44264 bytes — 16 UUID + 9 spread over three
`N_OSO` timestamps, and nothing else). darwin-arm64 adds one more block, its
ad-hoc `LC_CODE_SIGNATURE` blob, whose hashes cover the header those bytes are
in. Zero bytes of `__TEXT`, `__DATA_CONST`, the string table, the chained
fixups or the exports trie differ in any of the sixteen.

That names the fix precisely rather than as "reproducible flags": the UUID needs
`-Wl,-no_uuid` (or a `--build-id`-style deterministic value) and the `N_OSO`
timestamps need the object mtimes normalised — `ZERO_AR_DATE=1` handles the
archive case, but these are direct `.o` references from meson's per-target
directory. The arm64 signature follows automatically once the bytes it hashes
are stable. Worth doing: it is the last thing standing between this repo and a
byte-comparison of a committed prebuild against a CI-built one.

### The missing-`.gir` ledger is empty and should now be deleted

All ten `.gir` files have landed through the commit channel, which is what the
ledger existed to force, and `scripts/clear-satisfied-gir-gaps.mjs` emptied
itself in the same commit that added them:
`scripts/manifest-conformance/prebuild-gir-gaps.mjs` now exports
`PREBUILD_GIR_GAPS = {}`. Both auto-exits worked as designed — the clearing
script removes an entry whose file arrived, `prebuild-artifacts` fails an entry
that outlives its cause, `stage-prebuild.mjs` refuses a `.typelib` with no
`.gir` beside it (so the gap class is structurally closed, not just drained),
and `platforms-ci` fails a deferral for a target no leg builds.

**What is left is the reviewed human commit the ledger's own header prescribes**
— the clearing script deliberately leaves `{}` rather than deleting the module,
because a bot pushing under `[skip ci]` must not remove something
`scripts/audit-runtimes.mjs` imports. An empty ledger is a corpse by this repo's
own rule, so the file and its import go by hand.

It is not a one-line deletion, which is why it is still here. The module is
reachable from: the real import at `scripts/audit-runtimes.mjs:143` and its use
at `:1610`; `clear-satisfied-gir-gaps.mjs:49` (whose own tests are fixture-only,
so the SCRIPT stays — it is the mechanism for any future ledger); a comment in
`rules/platforms-ci.mjs:281`; the error text and summary line in
`prebuild-artifacts.mjs:366`/`:517`, which OFFER the ledger as the deferral
route and would otherwise point at a deleted file; the importer list that
`tests/e2e/prebuild-declaration-invariant` machine-checks; and the now-false
"Ten of sixty directories are in it today" in `docs/runtime-platform-axes.md:11`.
The rule's error text needs rewording in the same change: with the stager
refusing an incomplete triple, "restage this target" is the answer and
"record the gap" no longer has a file to record it in.

### A gate whose fixture reads what the gated job writes — SECOND instance

`gate-pushed-tree.sh` exists because `tests/e2e/platform-exemption-clearing`
seeded its fixture from a `gjsify.platformsUncommitted` value that the bot then
CLEARED, and `main` was red for every open PR for hours (f5d250b32, 2026-08-03).
The same shape reappeared inside the fix for it, and was caught in review rather
than in production: `tests/e2e/prebuild-declaration-invariant` copied the
missing-`.gir` ledger out of the checkout and asserted it had at least two
entries — while the clearing script that runs earlier in the same job exists to
reduce that file to `{}`. The first `main` run to land the ten `.gir` files would
have cleared all ten, failed the gate on the ledger it had just correctly
emptied, and discarded every downloaded binary. That fixture is hermetic now.

Twice is a class. What is missing is a check on the GATE LIST itself: no suite in
`gate-pushed-tree.sh`'s `node --test` list may read repository state that the
steps before it write (the two clearing scripts' outputs, the staged
`prebuilds/` directories, the manifests the generator rewrites). The awkward part
is that some of those suites read committed artifacts ON PURPOSE —
`prebuild-loader-path` asserts exact glibc floors of bytes this job replaces — so
the rule cannot be "fixtures may not read the tree". A first cut that would have
caught both instances: fail a gate-listed suite that reads a path the same job's
clearing scripts print on stdout, which is a set the job already computes.

### What still writes to `main` unverified, after the bot push got a gate

`commit-prebuilds` now runs the checks that read its own output on the tree it is
about to push (`Gate the tree being pushed`), which closed the incident where
f5d250b32 cleared `gjsify.platformsUncommitted` under a CI-skip directive and left
`tests/e2e/platform-exemption-clearing` red on every open PR for hours. A sweep
done while fixing it found five more holes in the same write path. THREE are now
fixed and deleted from this list: `packages/napi/napi-linux-x64/prebuilds/` is no
longer committed (it had no producer, so the honest shape was the
`gjsify.platformsUncommitted` entry its darwin sibling already carried); the
committed `.gir` files are validated on every target rather than only darwin; and
a rejected `git push` no longer discards the run's binaries. Two remain verified
reads with nothing done about them:

- **`download-artifact` MERGES and nothing prunes.** Each step extracts into an
  existing `prebuilds/<target>/` without clearing it, `git add` only adds, and the
  staging script's deletion refusal forbids removal — so a `meson.build` change
  that renames a library or drops a `.gir` leaves the stale file beside the new
  one, and `files: ["prebuilds"]` publishes both. One direction of the `.gir` half
  is closed (a directory with NO `.gir` now fails `prebuild-artifacts`); a STALE
  extra file is still silent, and that is the half this entry is about — no rule
  enumerates the expected file set, only its minimum.
- **`prebuild-artifacts`' dlopen probe degrades to a NOTE on `ubuntu-latest`,**
  which is the runner that gates the push: no libsoup3 / GStreamer / GTK4 /
  libepoxy, so the linux-x64 artifacts of http-soup-bridge, http2-native, webgl and
  webrtc-native are never actually loaded there. The gate proves declarations and
  file shape, not that an artifact loads.

Adjacent, same cause — and the release half is now CLOSED: `commitlint.yml` triggers on `push` to
`main` as well, so the release cut's direct `chore: release v${version}` commit is linted, which
matters because `@release-it/conventional-changelog` walks exactly those commits. The prebuild push
stays unlinted and NO trigger can change that — `[skip ci]` skips the workflow run itself, so
dropping it (the lever below) is the only route, and that is its own deliberate cost decision.

The one lever not pulled is **dropping the CI-skip directive from the prebuild
push**. Checked: it cannot loop (`prebuilds.yml`'s own `push` paths list sources,
meson files and scripts — not `packages/*/*/prebuilds/**`), and it would buy the
only coverage the new gate structurally cannot reach: the two specs that genuinely
LOAD a committed prebuild under GJS in `main.yml`'s `test` job. It costs one full
`main.yml` run per landing, which is rare. It detects rather than prevents, so it
is a complement to the gate, not a replacement — decide it deliberately.

### A PR touching only classifier-ignored paths is never linted, and the red lands on a stranger

AGENTS.md records this as a residual gap of selective CI: `check` (which runs the
repo-wide `gjsify lint` + `oxfmt --check`) is gated on the affected classifier's
`skip-all`, so a PR touching ONLY `packages/napi/**`, `packages/node-gi/**`,
`website/**` or docs does not lint. What the note understates is WHERE the failure
surfaces. It has now happened twice:

- `#949` (`style: satisfy the format gate after #944`)
- `#960` — four `packages/napi/napi/test/*-gate.mjs` files landed 3 lines over the
  120-column width. The PR was green because `check` was skipped; the first
  unrelated PR to run the repo-wide check (`#957`, which touches `prebuilds.yml`
  and `tests/`) went red on someone else's diff, and `main`'s own push run went red
  behind it.

Same shape as the `[skip ci]` prebuild incident: a change lands unvalidated and its
failure is attributed to whoever runs next. The difference is that this one is
cheap to close — `format --check` and `lint` are repo-wide, need no build, and cost
~0.3 s and a few seconds respectively. The blocker is that they live in the `check`
job together with the expensive tsc gate, so un-gating the job would un-gate tsc
too. So the fix is to split the two cheap repo-wide steps out of `check` into a job
that always runs (or move them into `audit-runtimes.yml`, which already runs on
every PR with no paths filter — but that job deliberately performs no install, and
both tools are devDeps, so it would need one). Pick deliberately; either way the
claim "lint is clean" stops depending on which paths a PR happened to touch.

### `@gjsify/lightningcss-native` references `gnu_get_libc_version`, which musl lacks

The committed glibc build declares no npm `libc` filter, so npm installs it on
musl hosts, where `ldd` reports `gnu_get_libc_version: symbol not found` on both
of its libraries. GI binds lazily, so this is not a load failure — it is an
unbound relocation that crashes if and when that path is called, the same shape
that hid `sab-native`'s `fcntl64`/`__cmsg_nxthdr` until the musl leg started
checking committed artifacts.

Unlike `sab-native`, the reference is not ours to remove: it comes from a
crates.io dependency of the pinned `refs/lightningcss` build. So the fix is
either an upstream/dependency change, or a musl-built sibling package with
`libc: ["musl"]` beside a `libc: ["glibc"]` parent — which needs the target
vocabulary to carry a libc component it deliberately does not have today, plus
two new published npm names. Until then it is an ACCEPTED gap in
`musl_gap_reason()` in `.github/prebuild-toolchain/musl-build.sh`, printed on
every musl run, and that entry FAILS the leg the day the symbol stops appearing —
so it cannot outlive the problem.

### `@gjsify/webrtc` cannot work on Alpine / postmarketOS — no `webrtcbin` element

Separate from the libc axis and easy to mistake for it. The musl leg's
committed-prebuild check reports `webrtc-native` as fully resolving, which is true
and misleading: `gst-plugins-bad` provides `libgstwebrtc-1.0.so.0`, so every
relocation binds, while `gst-inspect-1.0 webrtcbin` on the same image finds
nothing. GStreamer 1.28's nice plugin requires libnice >= 0.1.23 and Alpine ships
0.1.22, so the `webrtcbin` element and the `nice` plugin are not built at all.
Measured on `alpine:3.24`: library present, element absent, nice plugin absent.
Installing `libnice` does not help and that is measured too — with
`libnice-0.1.22-r0` genuinely installed from community, `/usr/lib/gstreamer-1.0/`
still contains no nice plugin at all, so `nicesrc`/`nicesink`/`webrtcbin` remain
missing. Alpine's libnice package simply does not build the GStreamer plugin, and
the phone does not even have libnice installed.

`@gjsify/webrtc` is built entirely on `webrtcbin`, so it is non-functional on
Alpine and on postmarketOS regardless of the prebuild. Layering the postmarketOS
repositories on top of Alpine does not help, and that is measured, not assumed:
on a real postmarketOS v26.06 device with the pmOS mirrors active, `libnice` is
still 0.1.22-r0 (taken from Alpine community unchanged) and
`Gst.ElementFactory.find()` finds no `webrtcbin`, `nicesrc` or `nicesink`, while
`dtlssrtpenc` and `rtpbin` are both present — exactly the shape a libnice-gated
nice plugin produces. Nothing to fix here; the blocker is a distro package
version, and the upstream threads say a maintainer MR bumping libnice plus a
`gst-plugins-bad` rebuild is all it takes:

- https://gitlab.postmarketos.org/postmarketOS/pmaports/-/work_items/4443
- https://gitlab.alpinelinux.org/alpine/aports/-/work_items/18092

Worth tracking because it is the one bridge whose prebuild can be perfect and
still unusable on a whole libc's worth of hosts, and because the reflex fix —
teaching the musl check to verify GStreamer elements — would be an accepted gap
from day one. Revisit when Alpine's libnice reaches 0.1.23; the right check then
is a real element probe, which would go green rather than being born red.

### `@gjsify/webgl` on win32-x64 — the exploratory leg exists; the declaration does not

`prebuilds.yml` carries a dispatch-only PAIR — `webgl-vala-c-win32` (Linux, emits
the Vala C + GIR) and `build-prebuilds-win32-experimental` (windows-latest,
compiles that C with MSVC against gvsbuild and load-tests through
`@gjsify/node-gi`) — behind the package's `prebuilt_vala_c` meson option. No
`win32-x64` token is in `gjsify.platforms`, deliberately: the declared-vs-built
invariant is symmetric, so the leg proves itself first. Full rationale, the
researched rejection of valac-on-Windows/MinGW, and the measured MSVC result live
in that block's header comment — do not duplicate them here.

**The leg is GREEN** (run 30808747504): all four generated `.c` files compile
under cl.exe 19.51 with zero language diagnostics, `gwebgl.dll` links, the
typelib records a `.dll` leaf, and `Gwebgl.WebGLRenderingContext` resolves
through `@gjsify/node-gi` — so the library is really loaded, not merely found.

**"What remains is a DECLARATION decision, not an engineering unknown" — that
sentence stood here and was WRONG, and the way it was wrong is the entry.** The
green artifact was a DEBUG build: `meson setup` ran without `--buildtype`, meson
defaults to `debug`, and MSVC's reading of `debug` is `b_vscrt=mdd`. Measured on
the win11-gjsify VM against the published artifact of that very run, `gwebgl.dll`
imports `VCRUNTIME140D.dll` and `ucrtbased.dll` — images that ship only with
Visual Studio and that Microsoft's terms forbid redistributing. Every other
import (`epoxy-0`, `gdk_pixbuf-2.0-0`, `glib-2.0-0`, `gobject-2.0-0`) resolved
from the batteries-included GTK bundle, so the library was two files short of
working and said so as `Failed to load shared library 'gwebgl.dll'` — naming the
dependent, never the missing dependency. The load test could not see it because
`windows-latest` HAS Visual Studio: the one artifact no user could load is
exactly the one the runner is equipped to load. Fixed by `--buildtype=release`
plus an import-table assertion that runs BEFORE the load test, because the
property is about redistribution and is answered by reading the file, not by
loading it. The general lesson is not "pass --buildtype": it is that a CI host
provisioned as a DEVELOPER machine silently satisfies developer-only
dependencies, so any artifact leaving that host needs at least one check that
inspects rather than executes.

What is still OPEN, i.e. what a promotion owes beyond that green dispatch:

- **`gwebgl.dll` imports `epoxy-0.dll`, and Windows has no system libepoxy.** On
  Linux and macOS libepoxy is a distro/Homebrew package, so the committed
  prebuild is a single library plus a typelib. On win32 the loadable unit is
  bigger than the artifact: it needs node-gi's batteries-included GTK bundle
  (which carries epoxy because GTK4 does). Which tarball ships what is a
  packaging decision nobody has taken — and it is the first case in this repo
  where a prebuild's runtime closure is not satisfiable from the host.
- **The load test proves `dlopen` + `…_get_type`, never RENDERING.** A
  display-less runner cannot drive a `Gtk.GLArea`, the same gap the darwin note
  in `build-prebuilds-macos-experimental` records. Pixels need a real desktop —
  the win11-gjsify VM is the machine for it. **Now measured there, and the
  blocker is one layer BELOW webgl: there is no GL implementation at all.**
  `Gdk.Display.create_gl_context()` fails with `No GL implementation is
  available`, so `three-geometry-teapot` opens a fully correct Adwaita window
  and paints that string where the teapot belongs — a `Gtk.GLArea` failure, not
  a `gi://Gwebgl` one. Two independent causes, and BOTH have to go:
  (a) the VM's display adapter is QEMU/QXL with no OpenGL ICD registered under
  `HKLM\...\OpenGLDrivers`, so Windows offers only the GDI generic OpenGL 1.1
  that GTK4 rejects; (b) **the batteries-included win32 bundle ships no GL
  implementation either** — its 41 DLLs include `epoxy-0.dll`, which is the GL
  *dispatch* layer and resolves nothing on its own. The windowing builder
  already seeds `/^libEGL.*\.dll$/i` + `/^libGLESv2.*\.dll$/i`, and those
  patterns matched NOTHING: the gvsbuild GTK4 release ZIP carries no ANGLE. So a
  seed that silently matches nothing is how the bundle came to promise
  "windowing" while shipping no GL — and both places that named ANGLE as shipped
  (the licence paragraph below, and `gtk-runtime-win32-x64/README.md`) were
  describing the seed list rather than the artifact; both are corrected.
  Consequence for the showcases: on a Windows host WITH a vendor ICD the GL
  showcases should work once webgl is promoted, but on a GPU-less host (VM, RDP
  session, CI) all three stay dark. Shipping ANGLE would fix both, since its
  libGLESv2 targets D3D11 and D3D11 has the WARP software rasteriser — that is a
  bundle-CONTENTS decision, so it belongs with the other "what does the win32
  bundle ship" work rather than here. The positive-assertion rule the typelib
  backers already follow (`REQUIRED_NAMESPACES`) is the shape the fix wants: a
  `--windowing` bundle that resolves no GL should FAIL its build, not warn.
- **Promotion is ONE change**: the `win32-x64` token in `gjsify.platforms`, a
  generated `@gjsify/webgl-win32-x64` package (`generate-platform-packages.mjs
  --write`) whose npm name is bootstrapped via `gjsify onboard` BEFORE the
  release that ships it, both `if: github.event_name == 'workflow_dispatch'`
  gates dropped, and the matching download + `git add` in `commit-prebuilds`.
- **It would close the concrete failure the `needsWebgl` entry above records** —
  `gjsify showcase three-geometry-teapot` dying at `gi://Gwebgl` on win32 — so
  the two are worth reading together, and a win32 prebuild changes which of that
  entry's two resolutions is the honest one.

The split itself generalises past webgl: every other Vala bridge in this
repository has the same "valac does not run on Windows" problem, and
`prebuilt_vala_c` is a per-package option today rather than a shared mechanism.
Lifting it is premature until a second bridge wants it — but the second one is
where the helper gets lifted, not the third.

The win32 leg hand-copies its artifacts instead of going through
`scripts/stage-prebuild.mjs`, and that is now the ONLY thing keeping a second
copy of staging logic alive. The reason it started that way: since ADR 0017
`resolveStageDir()` requires a sibling per-target package for any bridge that
declares no `gjsify.prebuilds`, and creating `@gjsify/webgl-win32-x64` IS the
declaration this leg exists to earn first — so there was no destination to stage
into. `build-prebuilds-musl` hit the identical wall (`sab-native-linux-x64-musl/
does not exist … Generate the platform packages first`), which is what made this
an ordering problem rather than anything about win32 or musl.

That question is ANSWERED, not open: the stager grew a NAMED scratch destination
(`--dest <dir>`, only valid together with `--allow-undeclared` — a relaxed
default would have been the wrong shape, since a destination outside the package
tree is only meaningful for a target the package does not promise), and
`musl-build.sh` uses it. **The remaining work is to delete this leg's `cp` and
call the stager the same way**, so the extension-matching and loader-path checks
cover the leg that most needs them: an exploratory port is exactly where a
renamed library or a missing sibling is most likely, and a hand-written `cp` is
the one path that cannot notice either. Left undone here only because it would
have made this PR depend on that one landing first.

### The GTK bundles declare `license: MIT` while shipping an LGPL closure

`@gjsify/gtk-runtime-{darwin-arm64,darwin-x64,win32-x64}` each carry 37–45
relocated LGPL/MPL/GPL libraries (GTK, GLib, Pango, cairo, freetype, fontconfig,
harfbuzz, libadwaita, GtkSourceView, and on win32 also librsvg, libxml2; ANGLE
is SEEDED by the win32 builder but absent from the gvsbuild ZIP, so no shipped
bundle contains it — see the webgl-on-win32 entry)
and all three declare `"license": "MIT"` — the terms of their own three source
files, not of the payload.

The TEXTS are no longer missing: `packages/node-gi/scripts/bundle-licenses.mjs`
derives `gtk/licenses/` + `gtk/THIRD-PARTY-NOTICES.md` from the source prefix,
per-binary on darwin through each dylib's Homebrew keg (an unattributable dylib
fails the build) and prefix-wide on win32, and `release.yml` gates on
`m.licenses.texts > 0`. What is still wrong is the MACHINE-READABLE half: an
automated consumer, a corporate license scanner or an SBOM generator reads the
`license` field and never opens the notices, so the one declaration a tool can
act on says something the tarball contradicts.

Not fixed alongside the notices because the correct spelling is a judgement, not
a mechanical edit: an SPDX expression naming the payload's real mix, versus
`SEE LICENSE IN gtk/THIRD-PARTY-NOTICES.md`, versus splitting the package's own
terms from the bundled ones. Whichever is chosen wants the same treatment as
everything else here — derived from what the builder measured, so it cannot drift
from the payload, which means `bundle-licenses.mjs` emitting the expression and a
conformance rule comparing it to the manifest rather than a hand-edited string.

### 17 of 32 `@girs/*` packages cannot be version-checked against the installed library

`gjsify system-check` now compares each `@girs/*` package's declared
`libraryVersion` against `pkg-config --modversion` and reports a `major.minor`
skew — which caught two real ones on the first host it ran on (`@girs/gtk-4.0`
4.23.0 vs GTK 4.22.4, `@girs/adw-1` 1.10.0 vs libadwaita 1.9.2, the second of
which nothing had ever surfaced).

It structurally cannot cover the rest. `libraryVersion` is only an upstream
release where the GIR declares a `<package version>`; otherwise ts-for-gir falls
back to the NAMESPACE version, which is shaped like a version and carries no
information. Measured across 32 installed packages: **12 real, 17 degenerate, 3
absent**. `@girs/gdk-4.0` declares `4.0.0` while GDK ships inside GTK 4.22.4, so
comparing it would report an 18-minor skew that does not exist — the check skips
those by construction rather than guessing, which is a false negative it takes
knowingly.

The 17 include `gdk-4.0` and `gsk-4.0` (GTK's own namespaces), `cairo-1.0`,
`graphene-1.0`, `gdkpixbuf-2.0`, `pangocairo-1.0`, the five `gst*-1.0`
satellites, `libxml2-2.0`, `gudev-1.0`, `gmodule-2.0`, `giounix-2.0`,
`freetype2-2.0`, `gda-6.0`. Several are exactly the libraries a canvas or media
path depends on, so this is not a tail of exotica.

Two ways out, and they are not equivalent:

1. **Fix it at the source.** ts-for-gir could emit a distinguishable value — the
   real `<package version>` when the GIR has one, and an explicit null (or a
   `libraryVersionSource` field) when it does not — instead of silently
   substituting the namespace version. That removes the guess from every
   consumer at once and is the smaller change, but it only helps namespaces whose
   GIR carries the version at all.
2. **Ship the `.gir` beside the artifact.** For the batteries-included bundles
   this is the only exact answer: the installed library's own GIR states its
   version, and `prebuild-artifacts` ALREADY requires a `.gir` next to every
   `.typelib` for packages declaring `gjsify.prebuilds` — for exactly this
   reason, quoting its own header, "it breaks regenerating that bridge's types
   from the artifact it ships". The `@gjsify/gtk-runtime-*` packages declare no
   `gjsify.prebuilds`, so that requirement does not reach them and they ship 37
   typelibs with no `.gir` at all. Bringing them into scope is the follow-up; it
   also unlocks generating types from the shipped artifact, which is the only
   route to types that cannot be skewed rather than merely checked.

### `devtools-export` loses its DBus name in the containerised runner

`tests/e2e/devtools-export/` had never run in CI. Listing it in `test:e2e` (PR #984) gave it a
first run, which failed — and the measurement points at the environment rather than at
`@gjsify/devtools`:

```
APP_ON_BUS=yes            the fixture DID own org.example.reprotest
INSTALL_RETURNED=null     installDevtools returned null
EXPORT_LOG=no             the "exported org.gjsify.Devtools" line never printed
GETSTATUS  -> GDBus.Error:...ServiceUnknown: The name org.example.reprotest
                          was not provided by any .service files
```

with, in between, `dbus-daemon` activating `org.freedesktop.portal.Desktop` on the fixture's
request and `xdg-desktop-portal` then failing on `Document portal fuse mount point unknown`.
So the app owned its name, lost it, and devtools never installed. The same suite passes on a
normal desktop session.

WHAT IS NOT KNOWN: why the name goes away. Candidates worth separating before touching any
code — the app exiting early (a GApplication with no window and `HANDLES_COMMAND_LINE` can
return from `run()` sooner than the driver's 20 s polling window suggests), the portal
activation churn interfering with name ownership, or `installDevtools` genuinely getting no
`app.get_dbus_connection()` at `startup` in that environment. The driver already captures the
app's own log (`APP_LOG_BEGIN`/`APP_LOG_END`); the CI run printed the KEY=value block but the
app log itself is the next thing to read.

THE FIX IS NOT A LEDGER ENTRY. It is currently in `scripts/e2e-unlisted-suites.mjs` so #984
could land honestly, but the entry says so: the right repair is a precondition in the suite's
own SKIP gate — it already carries nine of them — so it skips where an Adwaita GApplication
cannot complete startup and keeps running where it can. Removing the ledger entry in the same
change is what `check-e2e-suite-coverage.mjs` will then require.

### `logSignals` has no test

The one survivor of the twelve parked test sites `gjsify/todo-needs-anchor`
found on its first run. The other eleven are retired: two `on([])` gates became
`it.failing` (with their reason), four commented-out assertions went live and
three of them promptly failed — see below — two markers named nothing above a
complete statement and were deleted, and the worker-stress one was never a
deferral at all (its sentence says the test CLOSES a todo; `TODO` merely opened
a comment line, and an anchor had been bolted on to satisfy the rule).

**Why this one could not be converted.** `packages/gjs/utils/src/log.spec.ts`
holds a fully commented-out spec for `logSignals`, and `it.failing` is the wrong
tool for it: the spec deliberately produces an UNHANDLED REJECTION
(`createUncaughtException()` called without `await` — that is the event under
test), which is raised outside the callback's promise chain. `it.failing` cannot
catch it, and Node's default handler terminates the process, so reviving it
as-is would make the whole `@gjsify/utils` suite non-deterministic rather than
parking a failure.

What it needs is a test to WRITE, not a marker to convert: install a temporary
rejection handler, assert the signal fired, restore. Until then `describe(
'logSignals')` is an empty suite in the run output, which reads as coverage that
does not exist.

**What the retirement cost, recorded because it is the argument against parking
an assertion in the first place.** Three of the four revived assertions failed
immediately, each on a real defect now fixed at the source: `EventTarget`'s
listener map was TypeScript-`private` (a compile-time marker only, so at runtime
an ordinary ENUMERABLE own property that every subclass leaked into `for…in`,
`Object.keys` and `JSON.stringify`); `AbortSignal.reason` was a public class
field where the platform has a prototype getter, found by the same enumeration
spec one line after the first fix landed; and `AbortController` carried no
`Symbol.toStringTag`, so `String(controller)` said `[object Object]` while its
`AbortSignal` sibling had one all along. Four commented lines had been hiding
three shipped bugs.

### 10 small API gaps are declared only in a source comment

Also from `todo-needs-anchor`'s first run. None is a defect — each is a known
edge the implementation does not cover yet, written down at the call site and
tracked nowhere, so none of them can be prioritised against anything else.

| Site | Gap |
|---|---|
| `packages/gjs/utils/src/error.ts:42,43` | `Error.stackTraceLimit` / `Error.prepareStackTrace` unimplemented |
| `packages/gjs/utils/src/fs.ts:17` | path argument does not accept `Buffer` or `URL` |
| `packages/gjs/unit/src/index.ts:993` | `on(runtime, version)` takes no wildcard (`16.x.x`) |
| `packages/gjs/unit/src/index.ts:1008` | no `Browser` runtime in the matcher, though `tests/browser/` exists |
| `packages/gjs/unit/src/index.ts:1347` | only part of `node:assert` is wrapped |
| `packages/infra/cli/src/config.ts:254` | log level read from the wrong source, wants `cliArgs.logLevel` |
| `packages/infra/cli/src/utils/dlx-cache.ts:175` | `cleanupStalePrepareDirs` is a stub that ignores its TTL |
| `packages/node/fs/src/browser/stream.ts:225` | `FSWatcher` is a stub; the in-memory volume is single-process |
| `packages/node/querystring/src/error.ts:3` | node-error classes duplicated per package instead of shared |
| `packages/framework/webgl/…/uniform.ts:117,169` | `@girs/gwebgl-0.1` types reject `Uint32Array`/`Float32Array`, worked around by a cast |

The two `uniform.ts` casts and the `webtorrent-augment.d.ts` DefinitelyTyped note
are the only ones whose repair is in ANOTHER repo (ts-for-gir and
DefinitelyTyped); the rest are ordinary in-tree work.

### win32 `Adw.init()` — measured NOT to fault; two narrower gaps remain

#997's second finding (an `0xC0000005` access violation in `Adw.init()` on
win32) did not reproduce. Measured on the win11-gjsify VM with the published
`@gjsify/node-gi` 0.30.0 prebuild plus `@gjsify/gtk-runtime-win32-x64`, on a
host where `checkMsvcRuntime()` reports the Visual C++ runtime PRESENT: GLib
2.88.1 resolves, `Gtk.init()` returns, `Adw.init()` returns, exit 0. Per the
issue's own decisive test that makes it a DUPLICATE of the first finding — the
undeclared MSVC prerequisite, surfacing at first real use rather than at load.
Full write-up, including the session characterisation, is in ADR 0018.

What is NOT closed by that run, stated so neither reads as covered:

- **Session 0.** The probe was non-interactive (`isTTY` false on both ends,
  stdin on the null device — the condition the original report named) but ran in
  the interactive user session (`SESSIONNAME=Console`). A service / session-0
  context is the one place the original symptom could still live, and it is also
  what some CI agents look like.
- **The GTK bundle did not arrive with `npm install @gjsify/node-gi`.** The
  install script reported *"using the shipped prebuild for win32-x64"* and
  nothing else; `@gjsify/gtk-runtime-win32-x64` (78 MB) had to be installed
  EXPLICITLY before any namespace would resolve. That may be npm 11 declining to
  run install scripts by default (`npm warn allow-scripts`, which did fire here
  and forced the script to be run by hand) rather than a gap in the package —
  the two are not separable from this one observation. Worth one deliberate
  measurement on a clean host with scripts approved, because "install node-gi and
  it works" is what the win32 story currently promises.
