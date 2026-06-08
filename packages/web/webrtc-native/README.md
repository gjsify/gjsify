# @gjsify/webrtc-native

Native Vala/GObject prebuild that makes GStreamer's `webrtcbin` signals safe to handle from GJS. Provides three main-thread signal bridges — `WebrtcbinBridge`, `DataChannelBridge`, and `PromiseBridge` — that capture callbacks fired on GStreamer's streaming thread and re-emit them via `GLib.Idle.add()` on the GLib main context. Consumed internally by `@gjsify/webrtc`; not intended for direct use.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

This is an internal native bridge package — installed automatically as a dependency of `@gjsify/webrtc`, not separately.

```typescript
// Use @gjsify/webrtc instead:
import { RTCPeerConnection } from '@gjsify/webrtc';
```

The `@gjsify/webrtc-native` prebuild (`.so` + `.typelib`) is loaded automatically by `gjsify run` via the `GI_TYPELIB_PATH`/`LD_LIBRARY_PATH` detection in the CLI.

## License

MIT
