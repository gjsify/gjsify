# Phase D-2 POC — WASM/WASI host import audit

**Date**: 2026-05-09
**Source**:
- `refs/lightningcss/wasm/{index.mjs,wasm-node.mjs,async.mjs}` + `refs/lightningcss/node/Cargo.toml`
- `refs/rolldown/packages/rolldown/src/rolldown-binding.wasi.cjs` + `refs/rolldown/crates/rolldown_binding/Cargo.toml`

## TL;DR

| | lightningcss-wasm | rolldown wasm32-wasi |
|---|---|---|
| Format | NAPI on plain WASM (no WASI) | NAPI on WASI + threads |
| Requires WASI shim? | **No** — single `__getrandom_v03_custom` fn + napi-wasm | **Yes** — full `node:wasi` `WASI` class with preopens |
| Requires SharedArrayBuffer? | No | **Yes** — `WebAssembly.Memory({ shared: true, initial: 16384, maximum: 65536 })` (≥1 GiB shared addr space) |
| Requires worker_threads? | No | **Yes** — `wasi-worker.mjs` for async work pool |
| Host import surface | ~1 namespace (`env`) with napi + 2 custom fns | `wasi_snapshot_preview1` + `env` (napi) + emnapi worker IPC |
| GJS viability (today) | **High** — single small shim | **Low** — SAB hole in stock GJS blocks mode 0 (see STATUS.md) |

**Strategic implication.** Rolldown-WASM under stock GJS is blocked by the SharedArrayBuffer disable in SpiderMonkey. We can either:
- (a) Rebuild rolldown WASM without `wasi-threads` — single-threaded variant, smaller import surface, no SAB. Patches needed in `refs/rolldown/crates/rolldown_binding/`. **Untested upstream**.
- (b) Skip rolldown-WASM, go straight to **rolldown FFI** as the productization target.

Lightningcss-WASM is independent of this and is a clean POC target.

## lightningcss-wasm

### Architecture

`refs/lightningcss/wasm/wasm-node.mjs` is the canonical loader (8 lines of host setup). Reads:

```js
import { Environment, napi } from 'napi-wasm';
import fs from 'fs';
import { webcrypto as crypto } from 'node:crypto';

const wasmBytes = fs.readFileSync(new URL('lightningcss_node.wasm', import.meta.url));
const wasmModule = new WebAssembly.Module(wasmBytes);
const instance = new WebAssembly.Instance(wasmModule, {
  env: {
    ...napi,                    // ~30 NAPI-shim host functions (defined in `napi-wasm` npm package)
    await_promise_sync,         // async-bridge fn (lives in async.mjs)
    __getrandom_v03_custom: (ptr, len) => {
      const buf = env.memory.subarray(ptr, ptr + len);
      crypto.getRandomValues(buf);
    },
  },
});
instance.exports.register_module();
```

### Required GJS implementation

| Host import | Needs |
|---|---|
| `napi-wasm` package's `napi` namespace | Bundle the npm package (pure JS, ESM) into `@gjsify/lightningcss-wasm` directly. Inspect for any Node-specific APIs |
| `await_promise_sync` | Pure-JS, defined in `async.mjs`. Bundle as-is |
| `__getrandom_v03_custom` | `globalThis.crypto.getRandomValues` (provided by `@gjsify/webcrypto/register`) ✓ |
| `WebAssembly.Module`+`Instance` constructors | Native in SpiderMonkey 140 ✓ |
| `fs.readFileSync(.wasm)` | Replace with `fetch('file:///…').arrayBuffer()` via `@gjsify/fetch` ✓ — or `fs.readFileSync` via `@gjsify/fs` ✓ |

**No WASI. No SAB. No threads.** The total host surface is ~30 functions from `napi-wasm` + 2 custom + crypto polyfill (already in gjsify).

### Effort estimate (POC)

- 1 day to bootstrap `@gjsify/lightningcss-wasm` if `napi-wasm` runs unmodified on GJS.
- 2-3 days if `napi-wasm` needs porting (Node-specific bits like `Buffer.from(arrayBuffer)` may need `@gjsify/buffer` aliasing).

## rolldown wasm32-wasi

### Architecture

`refs/rolldown/packages/rolldown/src/rolldown-binding.wasi.cjs` is the auto-generated NAPI-RS WASI loader. Setup (lines 1-80):

```js
const { WASI: __nodeWASI } = require('node:wasi');
const { Worker } = require('node:worker_threads');
const {
  createOnMessage: __wasmCreateOnMessageForFsProxy,
  getDefaultContext: __emnapiGetDefaultContext,
  instantiateNapiModuleSync: __emnapiInstantiateNapiModuleSync,
} = require('@napi-rs/wasm-runtime');

const __wasi = new __nodeWASI({
  version: 'preview1',
  env: process.env,
  preopens: { [__rootDir]: __rootDir },
});

const __sharedMemory = new WebAssembly.Memory({
  initial: 16384,                // 1 GiB minimum
  maximum: 65536,                // 4 GiB maximum
  shared: true,                  // ← SharedArrayBuffer required
});

const { napiModule } = __emnapiInstantiateNapiModuleSync(wasmBytes, {
  context: __emnapiGetDefaultContext(),
  asyncWorkPoolSize: 4,
  reuseWorker: true,
  wasi: __wasi,
  onCreateWorker() {
    const worker = new Worker(/* wasi-worker.mjs */);
    // … hack to prevent Node main from waiting on workers …
  },
});
```

### Required GJS implementation

| Host import | Needs | Status |
|---|---|---|
| `@napi-rs/wasm-runtime` (3 named exports) | Port to `packages/infra/napi-wasm-runtime-gjs/`. Audit Node-specific code paths inside the package. **Largest single piece of work** | ⚠ |
| `node:wasi` `WASI` class with `preopens` | Implement via `@gjsify/wasi` package. Maps `wasi_snapshot_preview1` syscalls (~30 functions) to `@gjsify/{fs,process,timers,…}` | ⚠ |
| `node:worker_threads` `Worker` | gjsify already has partial `@gjsify/worker_threads` (subprocess-based). NAPI-RS uses workers for async work pool — needs in-process workers, not subprocesses, OR fallback to single-threaded | ⚠⚠ |
| `WebAssembly.Memory({ shared: true })` | **Stock GJS rejects** — Mozilla disables `SharedArrayBuffer` constructor. Tracked in STATUS.md "SharedArrayBuffer cross-process sharing" | ❌ |

### The SAB blocker — three escape paths

1. **Rebuild rolldown without `wasi-threads`.** `refs/rolldown/crates/rolldown_binding/Cargo.toml` and rolldown's NAPI-RS config produce only the threaded variant today. Custom `cargo build --target wasm32-wasi --release` with the threading feature off would produce a non-shared-memory WASM. **Risk**: rolldown's bundling uses `rayon`/`tokio` parallelism — losing it could degrade bundle time 5-10×; uncertain whether the build even compiles cleanly without threads.
2. **Upstream patch enabling SAB in GJS.** Multi-quarter, out of scope. Documented as out-of-scope under STATUS.md "SharedArrayBuffer cross-process sharing" already.
3. **Skip rolldown-WASM entirely.** Go straight to **rolldown FFI** for productization. WASM POC becomes "documented dead-end" rather than a real comparison target.

**Decision (this audit)**: Try option (1) for the POC. If `cargo build --target wasm32-wasi --release` without `wasi-threads` fails or produces a binary that doesn't link/run, fall back to option (3) and document accordingly.

### Effort estimate (POC)

- Best case: 1-2 weeks if `wasi-threads` removal compiles cleanly + `@napi-rs/wasm-runtime` ports cleanly.
- Worst case: 4+ weeks if either constraint fails — at which point we abandon rolldown-WASM and POC 1's rolldown deliverable becomes "dead-end documented".

## Action items

1. ✅ **Audit complete.** lightningcss-wasm = simple, rolldown-wasm = SAB-blocked.
2. Prioritize **`@gjsify/wasi` design for rolldown** as Phase A's Big Risk Item — but build it ONLY after lightningcss-WASM succeeds without WASI (early signal that `napi-wasm` ports cleanly to GJS).
3. **Start POC 2 (Vala+Rust FFI) for both lightningcss + rolldown immediately in parallel** with POC 1 lightningcss-WASM. lightningcss already ships `lightningcss_c_bindings` crate (`refs/lightningcss/c/`) which gives us a ready-made C ABI — POC 2 lightningcss-FFI is dramatically simpler than the plan assumed.
