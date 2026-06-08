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

Ships as a prebuilt `.so` + `.typelib` for `linux-x86_64`. Build from source with `meson` + `valac` + `libnghttp2-devel` if your architecture is not covered.

## License

MIT
