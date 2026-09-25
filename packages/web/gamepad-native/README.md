# @gjsify/gamepad-native

SDL3's gamepad subsystem behind a small GObject API — the backend of
[`@gjsify/gamepad`](../gamepad/README.md) on macOS and Windows, and on Linux beside
libmanette until it has been compared against it on real controllers
(`GJSIFY_GAMEPAD_BACKEND`, see that README).

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

No test uses a fake. On every OS:

- `monitor-lifecycle`: C. 20 start/update/close cycles, two monitors at once, and a
  dispose without close.

Per OS:

- **darwin**: `monitor-lifecycle-gjs` (the same through the typelib under `gjs`, which
  proves the GIR annotations `@gjsify/gamepad` relies on) and `monitor-lifecycle-leaks`
  (the C test under `leaks --atExit`, which must report 0 leaks).
- **linux**: `monitor-lifecycle-gjs`; `monitor-lifecycle-valgrind`
  (`test/valgrind-growth.py`: memcheck at 1 and at 20 cycles; nothing lost, and the
  reachable set must not grow with the count, because most of what this library could
  leak stays reachable through a static); `elf-deps` (`test/check-elf-deps.py` reads
  DT_NEEDED and the exported symbols back from the built file); `uinput-pad` (a virtual
  Xbox 360 pad through the kernel's uinput: connect, A, left stick, left trigger,
  disconnect, each read through the shim; skipped without a writable `/dev/uinput`
  unless `GJSIFY_GAMEPAD_REQUIRE_UINPUT=1`). `uinput-pad --serve` drives the same
  device from stdin, for running the JS sources against it.
- **win32**: `win32-message-queue` (see below). CI also loads the prebuild under Node
  through `@gjsify/node-gi` (`test/probe-node-gi.mjs`) and reads a ViGEmBus virtual
  XInput pad (`test/vigem-pad.py`).

With a controller attached, set `GJSIFY_GAMEPAD_EXPECT_DEVICES=<n>`. The tests assert the
count rather than assume zero.

## Updating SDL

Change the four version lines in `subprojects/sdl3.wrap` together and take the sha256 from
the release tarball. Then rebuild, run the tests, and re-measure what ADR 0075 Amendment 1
records: the size of each library and its dependencies (`otool -L`, `readelf -d` via the
`elf-deps` test, `dumpbin /dependents` in the win32 job). Only OS libraries and
GLib/GObject may appear.

## Per-OS build notes

- **One meson.build.** meson's CMake module drops SDL's link list on every OS, so each
  OS names what the kept subsystems reach: frameworks on darwin, `m`/`dl`/threads on
  linux, the system import libraries on win32. Re-enabling a trimmed subsystem then
  fails the link instead of quietly adding a runtime dependency.
- **linux, symbol privacy.** ELF has one flat namespace, so SDL's symbols must be
  hidden or another SDL in the process would interpose them: `--exclude-libs,ALL` plus
  the version script `src/c/gjsify-gamepad.map`, and `--gc-sections` with
  `-ffunction-sections -fdata-sections` in place of darwin's `-dead_strip`.
- **linux, SDL CMake flags.** `SDL_DEPS_SHARED=ON` (libudev and D-Bus are `dlopen`ed,
  never `DT_NEEDED`; the build needs only their headers), `SDL_LIBUDEV=ON` (without
  udev at run time SDL watches `/dev/input` with inotify), `SDL_DBUS=ON`,
  `SDL_IBUS/LIBURING=OFF`, and `SDL_UNIX_CONSOLE_BUILD=ON`, without which SDL refuses
  to configure on a host without X11 or Wayland headers even with video off.
- **linux, hidraw.** SDL's HIDAPI drivers read `/dev/hidraw*`, often root-only unless a
  udev rule (such as the `steam-devices` package) grants access. The evdev path works
  without it; check hidraw access on the comparison hardware.
- **win32, exports.** A PE DLL exports nothing unless told to, so the header marks the
  API `GJSIFY_GAMEPAD_API` (dllexport while the library compiles). SDL, linked
  statically, stays unexported. No `g_autoptr`: MSVC has no cleanup attribute.
- **win32, DirectInput is kept.** SDL checks for `dinput.h` only inside
  `if(SDL_DIRECTX)`, which needs audio or video. Left alone, the DirectInput joystick
  and haptic drivers compile out silently, and every generic HID pad that is neither
  an XInput device nor a HIDAPI vendor controller disappears. `meson.build` supplies
  `HAVE_DINPUT_H=1` and links `dinput8`, a DLL every Windows ships.
- **win32, the GIR** is scanned on Linux by the same CI run (g-ir-scanner has to build
  and run a dumper against the library) and compiled here with `-Dprebuilt_gir=<dir>`,
  recording the DLL leaf meson produced.
- **win32, the message pump.** A GLib main loop dispatches no Windows messages. SDL
  creates one message-only helper window on the calling thread (DirectInput's
  cooperative-level HWND, `DefWindowProc`) and runs device notification and raw input
  on its own thread with its own message loop (`SDL_HINT_JOYSTICK_THREAD`, default on);
  XInput and HIDAPI are polled from `SDL_UpdateGamepads()`. `test/win32-message-queue.c`
  measures what that leaves on a thread that never pumps.

## License

MIT. The statically linked SDL3 is zlib-licensed (Sam Lantinga and SDL contributors);
see `docs/attribution.md`.
