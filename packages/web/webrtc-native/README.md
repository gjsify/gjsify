# @gjsify/webrtc-native

Native Vala/GObject prebuild that makes GStreamer's `webrtcbin` signals safe to handle from GJS. Provides three main-thread signal bridges — `WebrtcbinBridge`, `DataChannelBridge`, and `PromiseBridge` — that capture callbacks fired on GStreamer's streaming thread and re-emit them via `GLib.Idle.add()` on the GLib main context. Consumed internally by `@gjsify/webrtc`; not intended for direct use.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

This is an internal native bridge package — installed automatically as a dependency of `@gjsify/webrtc`, not separately.

```typescript
// Use @gjsify/webrtc instead:
import { RTCPeerConnection } from '@gjsify/webrtc';
```

The `@gjsify/webrtc-native` prebuild (library + `.typelib`) is loaded automatically by `gjsify run` via the CLI's native-package detection, which sets `GI_TYPELIB_PATH` and the host's loader variable (`LD_LIBRARY_PATH` on Linux, `DYLD_LIBRARY_PATH` on macOS).

## Platform coverage

| Platform | Prebuild | Built by |
|---|---|---|
| `linux-x64` | ✅ `.so` + `.typelib` | native runner |
| `linux-arm64` | ✅ | native runner |
| `linux-ppc64`, `linux-s390x`, `linux-riscv64` | ✅ | QEMU emulation |
| macOS (`darwin-arm64` / `darwin-x64`) | ✅ `.dylib` + `.typelib` | native runners (`build-prebuilds-macos`) |
| Windows | ❌ | — no Vala/GI bridge in this repo targets Windows |

All prebuilds are produced by [`.github/workflows/prebuilds.yml`](../../../.github/workflows/prebuilds.yml)
and committed back to the repository.

On macOS the bridge builds against Homebrew's unified `gstreamer` formula, which carries
`gstreamer-sdp-1.0` and `gstreamer-webrtc-1.0`; at runtime `@gjsify/webrtc` additionally needs
`brew install libnice-gstreamer` for ICE. Measured on macOS 27 arm64: `@gjsify/webrtc`'s GJS
suite passes 309/309 against the darwin prebuild.

## License

MIT
