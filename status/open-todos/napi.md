<!-- Authored Open-TODO sections — area: @gjsify/napi.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

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


### `@gjsify/napi` — a tsfn claim nobody hands back still leaks its control block

`finalize_env_tsfns` (`src/cc/tsfn.cc`) partitions `thread_count` by owner; only the claims a foreign thread demonstrably holds are joined (2 s deadline). Whatever is still outstanding afterwards makes the tsfn DETACH — its JS-side resources are freed and the control block is handed to whichever thread returns the last claim, which then frees it. That is Node's `MaybeDelete()` posture and it closes the force-free UAF window for good, but it inherits Node's consequence: **if no thread ever returns the claim, ~840 bytes leak for the process lifetime** (measured: 264 direct + 576 indirect, valgrind, 0 memory errors). Both outcomes warn unconditionally. Two residuals worth a decision later: an unattributed claim a foreign thread genuinely holds is not joined (safe, but the warning can only say "never attributed" — closing it needs an ownership signal N-API does not expose); nothing reclaims a detached control block at process exit (a per-env registry of detached tsfns would trade the leak for a much harder lifetime question; today the leak is accepted because Node accepts it). Measured on every CI run by `test/tsfn-teardown-gate.mjs` (Linux + macOS legs).


### N-API host in GJS (`@gjsify/napi`) — Phase 2+ follow-ups

Phase 0 (full `js_native_api.h` + module loader; better-sqlite3 byte-identical to Node, valgrind-clean; conformance green with every divergence carrying its Phase-0 reason in `conformance/ledger.json`) and Phase 1 (tsfn surface; node-gi-under-shim byte-identical to native `gi://` across node-gi's whole conformance suite, nothing ledgered — a CI test oracle, NOT a production path) are complete; the transparent `.node`→`loadAddon` build integration has shipped (`napiNodeAddonPlugin`, e2e-gated byte-vs-Node on all four addon-loading conventions). Open:

- **implement the deferred non-experimental stubs** — `napi_*_bigint_words`, `node_api_create_external_string_{latin1,utf16}`, `napi_create_external_arraybuffer` (currently loud stubs → several of the 8 ledgered conformance programs).
- **crash-class hardening (deferred, non-blocking)** — null `state->wrap` via a back-pointer to close a theoretical teardown-finalizer sibling-unwrap UAF; Node-parity, not a graduation gate.
- **the 4 `NAPI_EXPERIMENTAL` conformance addons** — `node_api_post_finalizer` / `node_api_create_object_with_properties` / `node_api_is_sharedarraybuffer`.
- **node-gyp golden drift watch** — the node-gyp goldens were generated on Node 24 but CI runs Node 22; watch the first CI run for golden drift.
- **cross-platform prebuilds** — macOS darwin-arm64 SHIPPED incl. the tsfn gate (conformance/consumer/valgrind widening deferred; no maintained arm64-macOS valgrind). **Windows (win32-x64): ATTEMPTED, blocked at gjs-on-Windows** — shim-side portability is done and Linux-verified (`.def` exports, `LoadLibraryEx` loader, manual-dispatch `windows` job); a prebuilt MSVC mozjs-140 now exists (servo/mozjs `mozjs-sys-v140.13.0-0`), but no prebuilt libgjs exists for Windows and servo's patched static-lib layout is not the pkg-config `mozjs-140` gjs's meson consumes, so gjs must still be source-built (clang-cl) — and behind that waits the delay-load host-binding wall (no POSIX global symbol namespace; an unmodified node-gyp `.node` binds `napi_*` against the host `.exe`, which `gjs.exe` does not export). Unblocks when a prebuilt libgjs-win32 appears OR gjs builds against the servo mozjs AND the delay-load host-binding is solved.


### Can `@gjsify/napi` retire the hand-written `-native` bridges?

Asked because every `@gjsify/*-native` bridge (`rolldown-native`, `oxfmt-native`,
`lightningcss-native`, …) reimplements a Rust tool that already ships an npm napi
build. Recorded now because the reason this tree gave for "no" is **wrong**, and the
wrong reason makes the question look closed.

**Measured (2026-08-22, static, re-runnable):** npm `rolldown` does not fail under GJS
because of the N-API ABI. It fails one layer higher, in JavaScript.
`rolldown/dist/shared/binding-BmkJW3Wy.mjs:24` evaluates
`createRequire(import.meta.url)` at module scope, and the platform-detection preamble
then calls `__require("node:fs")` / `__require("node:child_process")` (lines 28, 29,
51, 86) to sniff musl vs glibc before choosing a binding. GJS refuses a synchronous
require of a builtin — that is the `createRequire: Cannot require builtin module "fs"
synchronously in GJS` seen when the oxc parser was linked in. **No `.node` is ever
opened.** The same generated-loader shape is in `oxlint/dist/bindings.js`
(`require("fs")` → `/usr/bin/ldd`), so this is napi-rs's loader, not a rolldown quirk.

**So the blocker is a module-loading strategy, not an ABI** — and this tree already
owns the bypass: `napiNodeAddonPlugin` + `detectNapiRsEntry`
(`packages/infra/rolldown-plugin-gjsify/src/plugins/napi-node-addon.ts`) intercept a
napi-rs package at bundle time and route its `.node` straight to `@gjsify/napi`'s
`loadAddon`, wrapper never evaluated.

**The open question is therefore NOT "can we?" but "why did it not fire here?"** — and
that must be measured, not reasoned about. Two candidates, both cheap to discriminate:
`rolldown`'s own `package.json` carries `@rolldown/binding-*` in `optionalDependencies`,
so `isNapiRsPackageJson` should already be true for it; but the import that broke was
the `rolldown/parseAst` SUBPATH, and the file that actually loads the binding is a
content-hashed internal chunk (`dist/shared/binding-*.mjs`) which is not one of the
package's declared `nativeEntrySpecs`. Discriminator: bundle a one-line
`import { parseAst } from 'rolldown/parseAst'` under `--app gjs` and log whether
`detectNapiRsEntry` returns non-null for the resolved file.

**Verdict: demotion, not deletion.** The bridges stay — `@gjsify/napi` is Tier 3, and a
default bundler engine cannot sit on an experimental host. But the entry above may be
recording a wall that is a detour, and the cost of the bridges is paid every release.
Graduation gates for reopening this: the Tier 2 items in the section above, plus
linux-arm64 / darwin-x64 napi prebuilds and a reproducible toolchain story.

