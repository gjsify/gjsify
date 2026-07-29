# @gjsify/lightningcss-native

A native Rust cdylib + Vala/GObject bridge that exposes the Rust `lightningcss` CSS transformer and minifier to GJS via `gi://`. Ships prebuilt native libraries + typelibs for Linux and macOS (see [Platform coverage](#platform-coverage)) and is loaded lazily at runtime — the consuming package (`@gjsify/rolldown-plugin-gjsify`'s `cssAsStringPlugin`) falls back to the npm `lightningcss` package when the prebuild is unavailable.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/lightningcss-native
```

## Usage

```typescript
import { hasNativeLightningcss, transform, bundle } from '@gjsify/lightningcss-native';

if (hasNativeLightningcss()) {
    // Transform a CSS string with GTK4-compatible lowering
    const result = transform({
        filename: 'app.css',
        code: 'a { color: oklch(50% 0.2 270); }',
        targets: 'firefox >= 60',
        minify: true,
    });
    console.log(new TextDecoder().decode(result.code));

    // Bundle a CSS entry file (resolves @import chains)
    const bundled = bundle({ filename: '/path/to/app.css', targets: 'firefox >= 60' });
}
```

The native bridge is consumed automatically by `gjsify build --app gjs` via `@gjsify/rolldown-plugin-gjsify`. Direct use is only needed when calling the CSS pipeline outside of a gjsify build.

## Building from source

```bash
gjsify workspace @gjsify/lightningcss-native build:prebuilds   # needs meson + vala + cargo
```

Unlike the other two Rust bridges this one has no `refs/` submodule — `lightningcss`,
`parcel_sourcemap` and `browserslist-rs` all come from crates.io.

### Dependency lock

`src/rust/Cargo.lock` is **committed**, and because there is no `refs/` pin here it is the *only*
thing tying the shipped prebuild to a known dependency graph. CI builds with `--locked`
(`${CI:+--locked}` on the `cargo build` in `meson.build`; every CI leg runs with `CI=true`),
so a lock that no longer satisfies `Cargo.toml` fails the run instead of being silently rewritten.
Local builds are unlocked, so editing `Cargo.toml` still just works — commit the resulting lock
diff with the change.

Updating a dependency is a deliberate act:

```bash
cd packages/infra/lightningcss-native/src/rust
cargo update -p <crate>        # or plain `cargo update` for the whole registry side
cargo tree -d                  # review what the update duplicated
cd -
gjsify workspace @gjsify/lightningcss-native build:prebuilds
```

Note that `lightningcss` is a pre-release line (`1.0.0-alpha.*`), where a caret requirement still
matches later alphas — so without the lock a plain rebuild can silently pick up a new alpha.

## Platform coverage

| Platform | Prebuild | Built by |
|---|---|---|
| `linux-x64` | ✅ `.so` + `.gir` + `.typelib` | native runner |
| `linux-arm64` | ✅ | native runner |
| `linux-ppc64`, `linux-s390x`, `linux-riscv64` | ✅ | QEMU emulation |
| `darwin-arm64` (macOS, Apple silicon) | ✅ `.dylib` + `.gir` + `.typelib` | `macos-latest` runner |
| `darwin-x64` (macOS, Intel) | ❌ | — no runner leg yet |
| Windows | ❌ | — no Vala/GI bridge in this repo targets Windows |

All prebuilds are produced by [`.github/workflows/prebuilds.yml`](../../../.github/workflows/prebuilds.yml)
and committed back to the repository.

**Known gap — a `darwin-arm64` prebuild is built and shipped, but the CLI does not
load it yet.** `detectNativePackages()` (`packages/infra/cli/src/utils/detect-native-packages.ts`)
hardcodes a `linux-` directory prefix, and `buildNativeEnv()` exports `LD_LIBRARY_PATH`,
which macOS `dyld` ignores in favour of `DYLD_LIBRARY_PATH`. Both are CLI-side fixes;
until they land, macOS falls back to the npm `lightningcss` package.

## License

MIT
