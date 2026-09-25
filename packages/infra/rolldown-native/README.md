# @gjsify/rolldown-native

A native Rust cdylib + Vala/GObject bridge that wraps the Rust `rolldown` bundler and exposes it to GJS via `gi://`. This is the default bundler engine used by `gjsify build` under GJS — npm's `rolldown` does not run under GJS — its JS entry evaluates `createRequire(import.meta.url)` at module scope and then synchronously requires `node:fs` / `node:child_process` for platform detection, which GJS refuses before any `.node` is ever opened — so this bridge is how gjsify bundles without a Node runtime. Includes a complete plugin bridge (`bundleWithPlugins`) for load, transform, resolveId, and render-chunk hooks. Ships prebuilt `.so` + `.typelib` for **Linux**; the source is now platform-neutral and cross-compiles for macOS, but no macOS prebuild is published yet — see [Platform coverage](#platform-coverage).

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

## Building from source

The Rust shim path-deps into the `refs/rolldown` submodule, pinned to the tag matching the
workspace's npm `rolldown` version (`package.json#gjsify.refsLockstep` — the two are builds of the
same bundler and must be the same release):

```bash
git submodule update --init refs/rolldown
gjsify workspace @gjsify/rolldown-native build:prebuilds   # needs meson + vala + cargo
```

### Dependency lock

`src/rust/Cargo.lock` is **committed**. It pins the crates.io half of the graph the way
[`scripts/check-refs-pin.mjs`](../../../scripts/check-refs-pin.mjs) pins the `refs/` half, so the
prebuild in this repository can be re-linked against the exact transitive set it was built from.
CI builds with `--locked` (`${CI:+--locked}` on the `cargo build` in `meson.build`; every CI leg
runs with `CI=true`), so a lock that no longer satisfies `Cargo.toml` fails the run instead of
being silently rewritten. Local builds are unlocked, so editing `Cargo.toml` still just works —
commit the resulting lock diff with the change.

Updating a dependency is a deliberate act:

```bash
cd packages/infra/rolldown-native/src/rust
cargo update -p <crate>        # or plain `cargo update` for the whole registry side
cargo tree -d                  # no crate may appear as BOTH a path and a registry entry
cd -
gjsify workspace @gjsify/rolldown-native build:prebuilds
```

Bumping `refs/rolldown` moves the `rolldown*` path crates' own versions and therefore invalidates
the lock — regenerate it in the same commit as the submodule pin and the npm `rolldown` bump.

## Platform coverage

| Platform | Prebuild | Built by |
|---|---|---|
| `linux-x64` | ✅ `.so` + `.gir` + `.typelib` | native runner |
| `linux-arm64` | ✅ | native runner |
| `linux-ppc64`, `linux-s390x`, `linux-riscv64` | ❌ | not built — the rolldown crate graph is too slow under QEMU |
| macOS (`darwin-arm64`) | ✅ `.dylib` + `.gir` + `.typelib` | native runner |
| macOS (`darwin-x64`) | ✅ | native runner |
| Windows | ❌ | — no Vala/GI bridge in this repo targets Windows |

All prebuilds are produced by [`.github/workflows/prebuilds.yml`](../../../.github/workflows/prebuilds.yml)
and committed back to the repository.

### Runtime system dependency: json-glib

The prebuild links **json-glib** (`BundlerSession` peeks at the hook name and request id of each
Rust-emitted JSON envelope before routing it), and it is a SYSTEM library on every target, like
GLib itself: `libjson-glib-1.0.so.0` on Linux, `@rpath/libjson-glib-1.0.0.dylib` on macOS, where
the rpath list ends in the Homebrew prefix ([docs/prebuilds.md](../../../docs/prebuilds.md)). Homebrew's
`gjs` formula does not pull it in, so a Mac needs `brew install json-glib`; `gjsify system-check`
lists it with the install command for the host.

Without it the typelib still resolves and the library fails to open. GJS reports that at the first
class access as `Unsupported type void, deriving from fundamental void`, so `gjsify build` probes
the library before choosing the engine (`probeNativeLibrary()` in `@gjsify/utils/core`) and prints
the file that failed, the dependency the loader named, and the install command.

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
