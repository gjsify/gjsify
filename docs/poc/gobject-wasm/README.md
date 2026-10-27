# PoC: real GObject in the browser, via WebAssembly

**This is a feasibility prototype, not a product.** It exists to answer one
question — *can node-gi, the N-API addon over girepository and libffi, be compiled
with Emscripten and run real GObject in a browser?* — and to put numbers on the
answer. Nothing here is on a release path, nothing here is supported, and the
build output is gitignored.

The answer is yes, in all four milestones, on Node, headless Chromium 149 and
headless Firefox 151, **single-threaded and without cross-origin isolation**.
Full write-up with every measurement:
[`docs/reports/2026-10-27-gobject-wasm-prototype.md`](../../reports/2026-10-27-gobject-wasm-prototype.md).

## Build and run

```sh
docs/poc/gobject-wasm/scripts/run-all.sh
```

~45 min cold on a 16-core box; ~2 GB under `$POC_ROOT` (default
`~/.cache/gjsify-wasm`, deliberately outside the repo). Every step is
skip-if-present, so a re-run after a failure resumes rather than restarting.

Then, separately, in a real browser:

```sh
POC_BROWSER=chromium node docs/poc/gobject-wasm/harness/run-browser.mjs   # or firefox
```

Needs Playwright; `PLAYWRIGHT_ROOT` points at a checkout that has it installed.

## What is where

| Path | What |
|---|---|
| `scripts/env.sh` | shared settings; `poc_activate` (emsdk + `PKG_CONFIG_LIBDIR`) and `poc_pkgconfig` (strips `-pthread`) |
| `scripts/00-emsdk.sh` | emsdk 6.0.13 |
| `scripts/10-libffi.sh` | libffi **git master** — the wasm32 closure backend is newer than any release |
| `scripts/20-glib.sh` | glib 2.90.1 + wasm-vips patches 04–10 + our four, static |
| `scripts/30-emnapi.sh` | emnapi 1.11.3, the `getUnsharedTextDecoderView` fix, `libemnapi.a` |
| `scripts/35-typelibs.sh` | the **i686** typelibs to embed (see below) |
| `scripts/40-node-gi.sh` | compile node-gi's `.cc` for wasm32 and link `node_gi.mjs` |
| `patches/` | our four GLib patches — [`patches/README.md`](patches/README.md) is the interesting file |
| `src/loop-wasm.cc`, `src/cairo-wasm.cc` | the only two node-gi translation units that had to be replaced |
| `harness/` | `engine.mjs` (instantiate + register), `milestones.mjs` (M3/M4, shared), `run-node.mjs`, `run-browser.mjs`, `serve.mjs`, `index.html` |
| `wasm32-emscripten.ini` | the meson cross file |

The two `*-wasm.cc` shims live **here, not in `packages/node-gi/node-gi/src/`**.
They are prototype scaffolding; putting them in the shipping tree would imply a
support promise this prototype does not make.

## The one change in the shipping tree

`packages/node-gi/node-gi/host.wasm.js` plus a `"wasm"` condition in that
package's `package.json` `imports`. That is the whole JS-side cost: a third host
seam beside `host.node.js` and `host.nativescript.js`. Plus one shared
`#ifdef __EMSCRIPTEN__` helper, `NodeGiCallIntoJs()` in `src/common.h`, used at
six call sites.

## Three things that are easy to get wrong

**The typelibs must be 32-bit.** A typelib bakes in the platform's type widths.
Feed wasm32 (ILP32) a host x86_64 typelib and `gssize` is read as 64 bit out of a
32-bit slot — the symptom is random marshalling corruption, not an obvious
word-size error. `35-typelibs.sh` pulls an i686 set from a distro package.

**`-pthread` must be stripped from pkg-config output.** GLib's `.pc` files carry
it unconditionally; passing it to a non-threaded link fails with
`wasm-ld: error: --shared-memory is disallowed`. `poc_pkgconfig` does the strip.
Staying off threads is what keeps the page free of COOP/COEP — the browser runs
report `cross_origin_isolated: false` and `shared_array_buffer: false`.

**`napi_make_callback` does not work outside Node.** emnapi forwards it to
`@emnapi/node-binding` and returns `napi_generic_failure` when that is absent —
which is always, in a browser. The GI callback then returns FALSE, the GSource is
removed, and *no handler ever runs, with no error anywhere*. That is what
`NodeGiCallIntoJs()` exists for: `napi_call_function` under Emscripten,
`napi_make_callback` everywhere else.
