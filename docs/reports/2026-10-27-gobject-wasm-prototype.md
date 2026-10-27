# Real GObject in the browser, via WebAssembly

Date 2026-10-27. Verdict: **yes — all four milestones are green on Node, headless Chromium 149 and
headless Firefox 151, single-threaded, with no cross-origin isolation. There was no wall. The cost
is not portability, it is the per-call price of the N-API boundary: ~3.7 µs per `emit` against
~16 ns for a plain-JS object, a factor of ~220.**

This was a feasibility prototype, deliberately scoped to stop at the first measured wall. It did
not hit one, so what follows is a cost report rather than a failure report.

Everything to reproduce it is in [`docs/poc/gobject-wasm/`](../poc/gobject-wasm/README.md);
`scripts/run-all.sh` builds from nothing in ~45 min and ~2 GB.

## Question

Can node-gi — an N-API addon over girepository + libffi — be compiled with Emscripten and run real
GObject in a browser, hosted via emnapi? Four milestones, stop at the first wall:

| | Gate |
|---|---|
| M1 | GLib + GObject + girepository + libffi under Emscripten, single-threaded if possible |
| M2 | node-gi compiled against it via emnapi, loaded in a headless browser |
| M3 | `GObject.registerClass` with one property + one signal; `notify::` / `connect` / `emit` through the shipping `gi.js`; startup and per-call cost vs. pure JS |
| M4 | a real namespace from a typelib in the Emscripten FS (static, no dlopen): one function + one callback |

"Through the shipping `gi.js`" is load-bearing. The harness never reaches past the L1 layer into
the engine, except for one explicit main-context tick in M4 that a browser has to drive by hand.

## M1 — the platform builds, and closures work

Green. The pieces, in the order they stopped being in doubt:

**libffi closures work in wasm32.** This was the real risk: GObject introspection cannot call a JS
callback without a closure, and closures mean synthesising a callable function pointer at runtime.
Upstream libffi **git master** (3.8.0, `bc55386`) has a wasm32 backend, `src/wasm/ffi.c`, that
implements exactly this with `EM_JS` on top of a growable function table. No fork was needed. A
consumer must link with `-sALLOW_TABLE_GROWTH` and export `addFunction` / `removeFunction`.

**GLib 2.90.1 builds static**, on kleisauke's wasm-vips patch series — but only patches 04–10 of
the ten. 01–03 ("do not build tools", "remove GRegex pre-emptively", "disable NLS") are wasm-vips'
product decisions and all three are wrong for us: girepository needs GRegex, girepository links
against the tool sources, and NLS comes off with a meson option. The 13 host tools that then fail
to link are accepted with `ninja -k 0` and never installed (`--tag devel`).

**Single-threaded throughout.** `-pthread` has to be stripped out of GLib's pkg-config output,
which carries it unconditionally; left in, the link fails with
`wasm-ld: error: --shared-memory is disallowed`. The payoff shows up in M2: no SharedArrayBuffer,
therefore no COOP/COEP, therefore the page needs no cross-origin isolation.

A C-level probe (`probe/gobj.c`) closed M1: `caption=hello notify=1 signal_sum=42`, `idle_ran=1`,
and **`emit` × 200,000 in 17.6 ms = 88 ns/op**. Hold on to that 88 ns — it is the contrast datum
for everything in M3.

| | raw | gzip -9 |
|---|---:|---:|
| `gobj-o3.wasm` (M1 probe: GLib+GObject+girepository+libffi, `-O3`) | 403,195 B | 229,430 B |

## M2 — node-gi runs, in Node and in a page

Green. All 14 of node-gi's remaining `.cc` files compiled **unmodified** for wasm32 with
`-DNODE_GI_HAS_LIBUV=0`, a define the shipping sources already understand. Only `loop.cc` (libuv)
and `cairo.cc` (a native cairo we do not have) were replaced, by shims that live in the PoC
directory rather than in the shipping tree.

Linked with `em++` into **one ES module** — `-sMODULARIZE=1 -sEXPORT_NAME=createNodeGi
-sEXPORT_ES6=1` → `node_gi.mjs` — which Node and the browser both import identically.

| | raw | gzip -9 |
|---|---:|---:|
| `node_gi.mjs` (release, `-O1`) | 1,289,023 B | 197,320 B |
| `node_gi.wasm` (release, `-O1`) | 3,988,955 B | 1,240,446 B |

So roughly **1.4 MB over the wire**, gzipped, for GLib + GObject + GIO + GModule + girepository +
libffi + emnapi + all of node-gi.

### The silent-callback bug, which cost the most time

Callbacks registered fine and then simply never ran — no error, anywhere. The cause:
`napi_make_callback` in emnapi forwards to `@emnapi/node-binding` and returns
`napi_generic_failure` when that package is absent, which is always, outside Node. node-gi then
treats the failed call as the callback having returned FALSE, so the GSource is removed and the
handler is never reached. Nothing logs.

Fix: one helper, `NodeGiCallIntoJs()` in `src/common.h` — `napi_call_function` under
`__EMSCRIPTEN__`, `napi_make_callback` everywhere else — swapped in at the six call sites
(`calls.cc`, `class.cc`, `loop.cc`, `private.cc` ×2, `signals.cc`).

One more emnapi fix was needed: `dist/library_napi.js` calls
`getUnsharedTextDecoderView('HEAPU8', 'ptr', 'end')`, an Emscripten JS macro whose signature has
since changed; against emsdk 6.0.13 it expands wrong and every string read back is garbage. Both
call sites are rewritten to `HEAPU8.subarray(ptr, end)`, which is what they mean in a build with no
SharedArrayBuffer.

## M3 and M4 — green on three hosts

All three hosts report identically on correctness: `m3_notify_fired: 1`, `m3_signal_sum: 42`,
`m4_markup_escape: "&lt;a &amp; b&gt;"`, `m4_idle_ran: 1`, `m4_idle_ticks: 1`. Both browser runs
report `cross_origin_isolated: false` and `shared_array_buffer: false`.

M4's callback goes JS function → libffi closure → GLib main context. There is no
`g_main_loop_run` anywhere: a browser main thread may not block, so the harness pumps the context
per tick via `iterateMainContext(false)`, which is the same portable pump `gi.js` already uses for
Bun and Deno. One tick was enough.

### Timings

200,000 iterations per leg, warmed, release build. ns per operation.

| | Node 24 | Chromium 149 | Firefox 151 |
|---|---:|---:|---:|
| engine startup (ms) | 86.6 | 93.8 | 207 |
| `requireGi('GObject')` (ms) | 3.4 | 3.2 | 1.0 |
| `requireGi('GLib')` (ms) | 3.9 | 4.0 | 2.0 |
| `emit` — GObject | 3,835 | 3,700 | 14,625 |
| `emit` — plain JS | 17 | 16 | 40 |
| set property — GObject | 15,309 | 12,256 | 48,615 |
| set property — plain JS | 90 | 58 | 10 |
| get property — GObject | 2,147 | 1,713 | 7,550 |
| get property — plain JS | 15 | 9 | 5 |

Startup is ~90 ms and a namespace costs ~3 ms. Both are fine. The per-call numbers are not.

### Where the 3.7 µs goes, and why that matters

M1 measured `emit` **in C, in the same wasm module**, at 88 ns. The same `emit` through `gi.js`
costs ~3,700 ns in Chromium. GObject's own signal machinery is therefore about **2 %** of the cost;
the other 98 % is the N-API boundary — argument marshalling, handle scopes, GValue boxing — and
none of it is Wasm's fault. A native node-gi build pays the same tax on the same boundary.

That reframes the result. The prototype's finding is *not* "Wasm is slow". It is that putting
GObject behind N-API costs ~200× a plain JS property, in any host, and that Wasm makes this visible
because the 88 ns floor underneath is measurable in the same process.

Firefox is consistently ~3.5× slower than Chromium on the GObject legs. Not investigated.

## The portability tax is in GLib, not in node-gi

This is the headline finding for anyone deciding what to do next.

**node-gi side**, the entire cost:

- 14 of 16 `.cc` files unchanged;
- 2 replaced by PoC shims (`loop.cc`, `cairo.cc`) which never enter the shipping tree;
- 1 new JS file, `host.wasm.js`, plus one `"wasm"` condition in `package.json`'s `imports`;
- 1 shared `#ifdef __EMSCRIPTEN__` helper, `NodeGiCallIntoJs()`, at 6 call sites.

**GLib side**: four patches, 111 insertions / 11 deletions across 6 files, *on top of* the seven
wasm-vips patches. Detail in [`patches/README.md`](../poc/gobject-wasm/patches/README.md):

| | What | Scope |
|---|---|---|
| 0001 | `g_array_sort` / `g_ptr_array_sort` / `g_list_sort` / `g_list_insert_sorted` / `g_slist_sort` / `g_slist_insert_sorted` given correct indirect-call signatures | `#ifdef __EMSCRIPTEN__` |
| 0002 | `gi_base_info_class_init` / `gi_base_info_init` given true `GClassInitFunc` / `GInstanceInitFunc` signatures | unconditional |
| 0003 | `gi_typelib_do_dlopen()` resolves against the main module (`shlib_str = NULL`) | `#ifdef __EMSCRIPTEN__` |
| 0004 | a real single-threaded `GWakeup` replacing wasm-vips' `g_error` stubs | wasm only |

0001 and 0002 are the same class of bug wasm-vips' patch 10 fixed in gobject/gio: wasm type-checks
indirect calls, so casting a `GCompareDataFunc` into a `GCompareFunc` slot traps instead of quietly
working. wasm-vips never compiled glib's containers or girepository, so that half was still open.
**0002 is correct on every platform** and is the one patch worth sending upstream as written.

0003 is four lines and is the one with consequences: forcing `shlib_str = NULL` means girepository
looks for a namespace's symbols in the main module, which requires `-sMAIN_MODULE=2`, which forces
`-sERROR_ON_UNDEFINED_SYMBOLS=0` and **forbids `-sWASM_ASYNC_COMPILATION=0`**. Instantiation is
therefore always asynchronous. `host.wasm.js` is shaped around that: `LAZY_NATIVE = true`, and the
embedder hands the N-API exports in through a one-shot global.

## Two things that will bite the next person

**Typelibs must be 32-bit.** A typelib bakes in the platform's type widths. wasm32 is ILP32; a
host x86_64 typelib declares `gssize` as 64-bit, so every size and offset is read out of the wrong
slot. The symptom is random marshalling corruption with no hint of a word-size problem. This
prototype extracts an i686 set from `glib2-2.88.4-1.fc44.i686.rpm`. girepository cannot generate
them here, because generating a typelib means *running* a target-architecture `g-ir-compiler`.

**Typelibs are embedded at link time** (`--embed-file tl@/typelibs`) and found via
`binding.prependSearchPath('/typelibs')`. There is no `GI_TYPELIB_PATH` and no host directory.

One harmless warning at every startup, worth not chasing:
`Unable to load platform-specific GIO introspection data: Typelib file for namespace 'GLibUnix'`.
GLibUnix/GioUnix describe POSIX APIs Emscripten does not provide and are deliberately not shipped.

## Paper-only: iOS

**Verdict: this does not transfer to iOS, and iOS does not need it to.**

The NativeScript iOS 9.x engine runs JavaScriptCore under the App Store's no-JIT rule. Wasm in a
jitless JSC is interpreted, so the ~3.7 µs boundary cost above — already 98 % marshalling — would
land on top of an interpreter rather than an optimising compiler. Nothing in the measurements here
survives that.

But the premise is wrong for iOS anyway. The reason to compile GLib to Wasm is that a *browser* has
no way to load a native library. An iOS app does: GLib, girepository and libffi can be built as
static native ARM64 libraries and linked into the app directly, which is what the existing
NativeScript work already does. libffi's closures are the only part that normally needs
JIT-adjacent tricks, and on iOS that is a known, solved, entitlement-shaped problem rather than a
Wasm one.

So: Wasm is the answer for the browser. Static native GLib is the answer for iOS. These are two
backends behind the same binding layer, not one technique stretched over both. **Not tested — this
section is reasoning from the engine's documented constraints, not measurement.**

## Paper-only: one source tree for native + WASM?

**Verdict: yes, and the prototype is most of the evidence. node-gi needs no fork.**

Measured, not argued: 14 of 16 translation units compiled for wasm32 with no change at all. The
delta is one `#ifdef __EMSCRIPTEN__` helper used at six call sites, one new host file selected by an
existing export-condition mechanism that already distinguishes Node from NativeScript, and two
translation units that need a wasm implementation.

Those two are the only honest open item, and neither is a fork:

- **`loop.cc`** — the libuv integration. `NODE_GI_HAS_LIBUV=0` already exists in the shipping
  sources for exactly this reason, and `gi.js` already has a portable pump for Bun and Deno. A
  `loop.wasm.cc` beside `loop.cc`, selected by the build, is the same shape as `host.wasm.js`
  beside `host.node.js`.
- **`cairo.cc`** — needs a cairo. Not a portability problem; a missing dependency. Either build
  cairo for wasm too, or compile the file out.

The thing that *would* need a fork is GLib, and only until the four patches land somewhere. 0002 is
upstreamable as written. 0001 and 0003 are `#ifdef __EMSCRIPTEN__` and plausibly acceptable
upstream, since GLib already carries an Emscripten platform block. 0004 replaces stubs that only
exist in wasm-vips' fork.

Per the workspace rule on third-party projects, none of these were filed anywhere: they are a patch
set in this repo, for a human to send on.

## Recommendation

**Write an ADR for a Wasm backend; do not start building one on this prototype's numbers.** The
feasibility question is answered and the answer is unambiguous. What the ADR has to decide is not
*can we* but *what is it for*, because ~3.7 µs per signal emit rules out anything that drives a UI
at frame rate and rules in plenty else — tooling, test harnesses, docs that execute real
introspection, a playground.

The ADR should also take the 88 ns C-level floor seriously as a separate thread of work. That 98 %
is paid by the native build too, and it is the larger number on both platforms.

## Disk and cleanup

Build trees under `~/.cache/gjsify-wasm` (~2 GB) and the PoC worktree are removed after this
report; nothing from either is tracked. The emsdk install is 1.7 GB and was kept.
