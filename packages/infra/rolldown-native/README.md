# @gjsify/rolldown-native

A native Rust cdylib + Vala/GObject bridge that wraps the Rust `rolldown` bundler and exposes it to GJS via `gi://`. This is the default bundler engine used by `gjsify build` under GJS — npm's `rolldown` is an N-API addon that cannot load in GJS, so this bridge is how gjsify bundles without a Node runtime. Includes a complete plugin bridge (`bundleWithPlugins`) for load, transform, resolveId, and render-chunk hooks. Ships prebuilt `.so` + `.typelib` for **Linux**; the source is now platform-neutral and cross-compiles for macOS, but no macOS prebuild is published yet — see [Platform coverage](#platform-coverage).

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/rolldown-native
```

## Usage

```typescript
import { hasNativeRolldown, bundle, bundleWithPlugins } from '@gjsify/rolldown-native';

if (hasNativeRolldown()) {
    // Simple bundle
    const result = bundle({
        input: [{ import: 'src/index.ts' }],
        format: 'esm',
        minify: false,
    });
    for (const item of result.output) {
        if (item.type === 'chunk') console.log(item.fileName, item.code.length, 'bytes');
    }
}
```

Under normal usage `@gjsify/rolldown-native` is consumed automatically by the gjsify CLI (`gjsify build`) — direct use is only needed when embedding the bundler in custom build tooling.

## Platform coverage

| Platform | Prebuild | Built by |
|---|---|---|
| `linux-x86_64` | ✅ `.so` + `.gir` + `.typelib` | native runner |
| `linux-aarch64` | ✅ | native runner |
| `linux-ppc64`, `linux-s390x`, `linux-riscv64` | ❌ | not built — the rolldown crate graph is too slow under QEMU |
| macOS (`darwin-arm64`) | ⏳ source-ready, no prebuild yet | pending a green `prebuilds.yml` macOS leg |
| macOS (`darwin-x64`) | ❌ | — |
| Windows | ❌ | — no Vala/GI bridge in this repo targets Windows |

All prebuilds are produced by [`.github/workflows/prebuilds.yml`](../../../.github/workflows/prebuilds.yml)
and committed back to the repository.

### macOS status

The **Rust-level blocker is gone.** The core used to wake the GLib main loop through three
`libc::eventfd(2)` descriptors — a Linux syscall the `libc` crate does not even expose on
Apple targets, so `cargo build` could not compile at all there. The wakeup channel is now a
plain anonymous pipe (`src/rust/src/wakeup.rs`), one portable implementation used on every
platform, so the crate cross-compiles: `cargo check --target aarch64-apple-darwin` is green.
`meson.build` was already macOS-ready (`.dylib` naming, `@loader_path` rpath).

What is still missing is a **native macOS build**: the `.dylib` + `.gir` + `.typelib` have to
be produced and load-tested by the `prebuilds.yml` darwin leg (Homebrew `vala`, `gobject-
introspection`, `json-glib`, `gjs`) before `darwin-arm64` is added to `package.json`'s
`gjsify.platforms` and a prebuild is committed. Until that leg is green, treat macOS as
unproven — a cross-`check` does not exercise linking, the GIR/typelib step, or `gi://` load.

Because `@gjsify/rolldown-native` is the only bundler engine available to `gjsify build`
under GJS, it is the last package gating a Node-free gjsify toolchain on macOS —
`@gjsify/lightningcss-native` and `@gjsify/oxfmt-native` already ship `darwin-arm64`
prebuilds.

### Wakeup channel (implementation note)

Three pipes carry "a plugin hook fired" / "the build finished" / "a `this.resolve()` result
is ready" from the tokio worker threads to the GLib main loop, which watches their read ends
with `GLib.IOChannel.unix_new()` + `add_watch()`. Two properties are load-bearing and easy to
break:

- **Both ends are `O_NONBLOCK` and a full buffer is not an error.** A pipe (unlike an eventfd
  counter) can fill up. The writer never blocks a tokio worker; an `EAGAIN` write is dropped
  on purpose, because a full buffer means the reader still owes a drain cycle — and the
  reader drains the pipe *before* it re-drains the request queue, so nothing is lost.
- **The reader consumes everything available**, not one fixed-size chunk. GLib's watch is
  level-triggered, so leftover bytes re-dispatch the callback — re-draining the queue for
  nothing — once per chunk until the pipe empties. Draining to `EAGAIN` collapses a burst of
  N hook wakeups back into a single main-loop iteration, which is the coalescing the eventfd
  counter used to provide for free.

Both ends are also `FD_CLOEXEC`, so a subprocess spawned from a plugin hook cannot inherit a
wakeup fd.

## License

MIT
