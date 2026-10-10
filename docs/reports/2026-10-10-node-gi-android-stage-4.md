# node-gi on Android, stage 4 (2026-10-10)

[ADR 0104](../adr/0104-real-gtk-and-gi-on-android-are-opt-in-tracks-beside-the-nativescript-port.md)
stage 4: node-gi changed so that it builds for Android and runs in a stock NativeScript 9.1.1 app.
Follows the [stage 3 report](2026-10-10-node-gi-on-nativescript-android.md).

## What changed in node-gi

- **Event loop.** `src/loop.cc` guards every libuv use with `NODE_GI_HAS_LIBUV`; the Android build
  leaves it undefined. The replacement pumps GLib from the runtime's `ALooper`: the main context's
  poll fds and a `timerfd` for its next deadline are added to the looper, and a callback signals a
  thread-safe function that drains the context on the JS thread.
- **JS layer.** `#host` (package.json `imports`) splits Node-only code into `host.node.js` and
  `host.nativescript.js`; `nativescript.webpack.js` adds the `nativescript` condition, and
  `./package.json` is exported so `@nativescript/webpack` finds the hook.
- **Build.** `npm run build:android` (`scripts/build-android.mjs`) cross-compiles `libnode_gi.so`
  with the NDK, no node-gyp.

## Measured

- `arm64-v8a` and `x86_64` build and link with no `uv_*` import; `readelf -d` lists no libuv.
- `x86_64` emulator (API 36), `@gjsify/node-gi` installed from a tarball and bundled by
  `@nativescript/webpack`. Every probe case passes, with no `FATAL` or `SIGSEGV`:
  `requireGi`, `get_home_dir`/`get_user_data_dir` under the app's files dir, an async Gio call
  with no explicit pump, `timeout_add`, `idle_add`, and a repeating timeout (4 ticks, then stops).
- **Timing.** A 50 ms `GLib.timeout_add` armed from a `setTimeout(…, 2000)` after startup fired
  after 50.4 ms. The same timeout armed during startup fired after 194 ms, while the app was still
  loading, so that number measures startup load, not the pump.

## Not done

- The full node-gi test suite on a device.
- A run on an arm64 device.
- The GI `.so` files and typelibs packaged as a NativeScript plugin.
- `android-arm64` and `android-x64` in `gjsify.platforms`; they need a loadable prebuild.

## Limits

- A blocking `GLib.MainLoop.run()` on the UI thread is unsupported: it would starve the looper
  that feeds the pump.
- The thread-safe function's `ref`/`unref` are no-ops, so JS-armed GLib work does not hold the
  process open (an Android app's lifetime is the Activity's).
- A same-thread source armed inside a C library signals no fd and triggers no drain request, so it
  first dispatches on the next drain the looper is woken for. JS-armed sources request a drain
  themselves. GDK's repeating timeout is the known case; it belongs to track C.
