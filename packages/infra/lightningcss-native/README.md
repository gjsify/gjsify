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
