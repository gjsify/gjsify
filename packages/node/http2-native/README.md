# @gjsify/http2-native

Optional native Vala bridge enabling advanced HTTP/2 primitives on GJS that are not reachable through libsoup's high-level GIR API: HPACK header-block encoding for PUSH_PROMISE / DATA frames, server-side push stream-ID allocation, and a thin `nghttp2_session` wrapper for future cleartext HTTP/2 (h2c) support. Consumed by `@gjsify/http2` to back `ServerHttp2Stream.pushStream()`, `respondWithFD()`, and `respondWithFile()`.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

This is an internal native bridge package — it is loaded automatically by `@gjsify/http2` when installed, not used directly. Install it only when you want to enable HTTP/2 server push and flow-control features (Phase 2):

```bash
gjsify install @gjsify/http2-native

# npm or yarn also work:
npm install @gjsify/http2-native
yarn add @gjsify/http2-native
```

## Usage

```typescript
// Loaded automatically by @gjsify/http2 when the prebuild is present.
// Gate on the availability predicate before using directly:
import { hasNativeHttp2, loadNativeHttp2 } from '@gjsify/http2-native';

if (hasNativeHttp2()) {
    const mod = loadNativeHttp2()!;
    const alloc = new mod.StreamIdAllocator();
    const streamId = alloc.next_stream_id();
    console.log('next push stream-ID:', streamId);
}
```

See [Platform coverage](#platform-coverage) for the prebuilt platforms.

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
and committed back to the repository. Build from source with `meson` + `valac` + nghttp2
development headers if your architecture is not covered.

On macOS, nghttp2 comes from Homebrew's keg-only `libnghttp2` formula. Because this bridge
resolves it through `cc.find_library('nghttp2', …)` rather than pkg-config, the build needs
`CPPFLAGS`/`LDFLAGS` pointed at `$(brew --prefix libnghttp2)` — the prebuilds workflow does
this for you.

**Known gap — a `darwin-arm64` prebuild is built and shipped, but the CLI does not
load it yet.** `detectNativePackages()` (`packages/infra/cli/src/utils/detect-native-packages.ts`)
hardcodes a `linux-` directory prefix, and `buildNativeEnv()` exports `LD_LIBRARY_PATH`,
which macOS `dyld` ignores in favour of `DYLD_LIBRARY_PATH`.

## License

MIT
