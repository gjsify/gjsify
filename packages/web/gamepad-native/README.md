# @gjsify/gamepad-native

SDL3's gamepad subsystem behind a small GObject API — the backend of
[`@gjsify/gamepad`](../gamepad/README.md) on macOS today, and on every OS once the
linux and win32 legs land.

Decision and measurements: [ADR 0075](../../../docs/adr/0075-darwin-gamepad-backend-is-sdl3-behind-a-gobject-shim.md),
Amendment 1.

## What it is

One C library, `libgjsifygamepad`, with SDL3 **statically linked and trimmed** to
joystick + gamepad, events, haptic, sensor and HIDAPI. Video, render, GPU, audio,
camera, dialog, tray, power and libusb are compiled out, so the runtime dependencies
are the OS and nothing else. The GI namespace is `GjsifyGamepad-1.0`:

| exposed | backed by |
|---|---|
| `Monitor.new()` (throws a `GLib.Error` when SDL does not start) | `SDL_InitSubSystem(SDL_INIT_GAMEPAD)`, reference-counted across monitors |
| `Monitor.update()` — the pump | `SDL_UpdateGamepads()`, then a diff of `SDL_GetGamepads()` against the tracked set |
| `device-added` / `device-removed` signals | that diff (removals first) |
| `Monitor.get_devices()`, `Monitor.close()` | — |
| `Device.get_buttons()` / `get_axes()` — 17 / 4 values in the **W3C standard layout** | `SDL_GetGamepadButton` / `SDL_GetGamepadAxis` |
| `Device.rumble()` / `rumble_triggers()` + `has_rumble()` / `has_trigger_rumble()` | `SDL_RumbleGamepad` / `SDL_RumbleGamepadTriggers` |
| `Device.has_sensor()` / `set_sensor_enabled()` / `get_sensor_data()` | SDL's gamepad sensors (gyro, accelerometer) |

The snapshot already speaks the W3C layout, so the SDL → W3C table exists once, in
`src/c/gjsify-gamepad.c`, for every OS and every JS host (GJS and Node through
`@gjsify/node-gi`).

## The things that are not obvious

- **The pump.** SDL is a pull backend: nothing moves unless `update()` runs.
  `@gjsify/gamepad` calls it at every `getGamepads()`, and the monitor adds a 100 ms
  GLib timeout on the thread-default main context so that `gamepadconnected` also
  reaches a page that has not polled yet.
- **The macOS main queue.** GameController.framework delivers on the main dispatch
  queue, which a GLib main loop never services (`docs/poc/gamepad-darwin-probe.m`,
  row 1). `update()` drains the main CFRunLoop's default mode first when it runs on
  the main thread, so SDL's GameController driver hears about controllers only it can see.
- **Background input.** `SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS=1`: a `gjs` or `node`
  process is never the foreground app.
- **Signals.** `SDL_HINT_NO_SIGNAL_HANDLERS=1`: otherwise SDL turns SIGINT/SIGTERM into
  an `SDL_EVENT_QUIT` that nobody reads, and the host stops reacting to Ctrl-C.
- **The event queue is not used.** Hotplug is a diff of SDL's device list, which keeps two
  monitors from stealing each other's events. `update()` flushes what SDL queued in the
  joystick and gamepad ranges so the queue does not grow.
- **Symbols.** Only `gjsify_gamepad_*` is exported. SDL stays private to this library,
  so a second SDL in the process cannot collide with it, and `-dead_strip` can drop every
  SDL function the shim does not reach.

## Building

```sh
gjsify workspace @gjsify/gamepad-native run build:prebuilds   # meson + stage-prebuild
```

`meson setup` downloads the pinned SDL release (`subprojects/sdl3.wrap`, sha256-checked)
and builds it through meson's CMake module. That needs `cmake` (`brew install cmake`), and
network access on the first setup. The build type is `minsize`, and it applies to SDL too.
Set `MACOSX_DEPLOYMENT_TARGET` to the repository floor (ADR 0074) for a build you ship.

## Testing

```sh
gjsify workspace @gjsify/gamepad-native run test:meson
```

Three meson tests cover the zero-device path, which is all a host without a controller
can prove. None of them uses a fake:

- `monitor-lifecycle`: C. 20 start/update/close cycles, two monitors at once, and a
  dispose without close.
- `monitor-lifecycle-gjs`: the same through the typelib under `gjs`, which proves the GIR
  annotations `@gjsify/gamepad` relies on.
- `monitor-lifecycle-leaks`: the C test under `leaks --atExit`, which must report 0 leaks.

With a controller attached, set `GJSIFY_GAMEPAD_EXPECT_DEVICES=<n>`. The tests assert the
count rather than assume zero.

## Updating SDL

Change the four version lines in `subprojects/sdl3.wrap` together and take the sha256 from
the release tarball. Then rebuild, run the tests, and re-measure what ADR 0075 Amendment 1
records: the size of the dylib and `otool -L`. Only `/System/Library/Frameworks`,
`/usr/lib` and GLib/GObject may appear.

## Other platforms — notes for the linux and win32 legs

The C source is portable; only the build differs. What each leg has to change:

- **`meson.build`:** drop the `host_machine.system() != 'darwin'` guard. Make the
  framework list and the darwin link arguments (`-exported_symbol`, `-dead_strip`,
  `-dead_strip_dylibs`, `-S`, `-headerpad_max_install_names`) darwin-only. The rpath is
  `$ORIGIN` on ELF (`install_rpath`/`build_rpath`), as the Vala bridges do.
- **linux, symbol privacy.** ELF has one flat namespace, so SDL's symbols MUST be hidden
  or another SDL in the process would interpose them. Link with
  `-Wl,--exclude-libs,ALL` plus a version script that exports only `gjsify_gamepad_*`,
  and use `-Wl,--gc-sections` with `-ffunction-sections -fdata-sections` in place of
  `-dead_strip`.
- **linux, SDL CMake flags.** The same trimmed set, and:
  - keep `SDL_DEPS_SHARED=ON` (the default), so libudev and D-Bus are `dlopen`ed at run
    time and never become `DT_NEEDED`;
  - `SDL_LIBUDEV=ON` (without udev, SDL falls back to inotify on `/dev/input`) and
    `SDL_DBUS=ON`;
  - `SDL_HIDAPI_LIBUSB=OFF`, `SDL_IBUS=OFF`, `SDL_LIBURING=OFF`.

  meson's CMake module drops SDL's link list here too. Expect `-lm`, `-ldl` and
  `-pthread`, and take the exact set from the link errors. Verify with `readelf -d`: the
  only `NEEDED` entries allowed are libc, libm, libdl, libpthread and GLib/GObject.
- **linux, hidraw.** SDL's HIDAPI drivers read `/dev/hidraw*`, which is often root-only
  unless a udev rule (such as the `steam-devices` package) grants access. Check that on
  the comparison hardware before relying on HIDAPI. The evdev path works without it.
- **win32 (MSVC, ADR 0073's per-package shape: `@gjsify/gamepad-native-win32-x64`).** The
  same CMake defines, and one measured trap: `SDL_DIRECTX` depends on
  `SDL_AUDIO OR SDL_VIDEO`, and `HAVE_DINPUT_H` is checked only inside `if(SDL_DIRECTX)`
  (SDL 3.4.16 `CMakeLists.txt` around lines 2194–2233). With both off, the DirectInput
  joystick and haptic drivers compile out and only XInput, RawInput, WGI and HIDAPI
  remain. Either accept that (it affects legacy DirectInput-only pads, and haptic, which
  needs DirectInput there), or pre-set the cache (`HAVE_DINPUT_H=1`) and link `dinput8`.
  Decide it in the win32 PR. meson's CMake module drops SDL's link list on every OS (see
  the framework list in `meson.build`), so the system libraries must be named by hand:
  at least `setupapi`, `cfgmgr32`, `hid`, `ole32`, `oleaut32`, `version`, `imm32`, `winmm`,
  plus `dinput8` if DirectInput stays. Take the exact set from the link errors, as the
  darwin list was. PE symbols are private by default, so no export list is needed. Record
  the typelib's `shared-library` exactly as meson emits it, as webview2-native does.
  Whether RawInput/WGI need a message pump in a GLib-driven process is **unmeasured**,
  and it is the first thing the leg must measure.
- **Both.** The CFRunLoop drain is `#ifdef __APPLE__` and compiles away. `leaks` is
  macOS-only, so the leak test needs its own spelling there (valgrind through
  `meson test --wrap`, or ASan's LeakSanitizer). Add a CI leg to
  `prebuilds.yml` (build, `meson test`, stager, load test, upload) and a
  `darwin-bridges.mjs`-style load row, then declare the target in `gjsify.platforms`
  with a `platformsUncommitted` entry and add the new name to
  `status/pending-npm-bootstrap.json`.

## License

MIT. The statically linked SDL3 is zlib-licensed (Sam Lantinga and SDL contributors);
see `docs/attribution.md`.
