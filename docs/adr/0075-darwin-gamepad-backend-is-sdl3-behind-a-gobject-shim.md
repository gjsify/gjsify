# 75. The darwin gamepad backend is SDL3 behind a GObject shim, reached through a device-source seam

- Status: **Proposed** — amended 2026-09-25, see § Amendment 1 (SDL3 becomes the gamepad
  backend on every OS, not only darwin)
- Scope: stage 1 (the seam and the honest darwin answer) shipped with this ADR; stages 3 and 4
  are built for darwin, linux and win32 (§ Amendment 1). The hardware checks, and on Linux
  the libmanette comparison, are open work in `status/open-todos.md`.
- Date: 2026-09-25
- Deciders: Pascal Garber
- Related: [ADR 0017 (native package distribution)](0017-native-package-distribution.md),
  [ADR 0018 (the OS axis)](0018-os-axis-declaration.md),
  [ADR 0022 (WebKit on darwin, the run-loop finding)](0022-webkit-on-darwin.md),
  ADR 0074 (one declared macOS floor; in review alongside this one, so not linked yet)

## Context

`@gjsify/gamepad` has exactly one backend: libmanette 0.2 via `gi://Manette`. libmanette is
Linux-only by construction, and that is measured, not assumed (`status/open-todos.md` has the
full audit). Its `meson.build` links `libevdev` with no `required:` switch, and libevdev is
Linux/FreeBSD only. On the macOS 27 arm64 host this ADR was written on:

```
$ brew info libmanette   →  Error: No available formula with the name "libmanette".
$ brew info libevdev     →  stable 1.13.7 … Not installed   (formula: depends_on :linux)
```

So on macOS `navigator.getGamepads()` answers the conformant empty list and
`hasGamepadBackend()` reports `false`. That answer is honest, but nothing can ever read a
controller there. Porting libmanette would mean porting libevdev first, so the fix is a new
backend.

### What macOS offers, and what the references do with it

There are two input paths, and both reference implementations ship both of them:

- **GameController.framework (GCF)**: Apple's API for MFi, Xbox, DualShock/DualSense and
  Switch Pro controllers. Buttons have names (`buttonA`, `leftTrigger`), not HID usages.
- **IOKit HID** (`IOHIDManager`): every HID joystick/gamepad, including the long tail GCF
  does not claim. Buttons are raw HID usages, and the layout is per device.

WebKit combines `cocoa/GameControllerGamepadProvider.mm` and `mac/HIDGamepadProvider.mm`
(with per-device `Dualshock3HIDGamepad`, `StadiaHIDGamepad`, …) in
`mac/MultiGamepadProvider.mm`. SDL ships `joystick/apple/SDL_mfijoystick.m` (GCF),
`joystick/darwin/SDL_iokitjoystick.c` (IOKit) and its HIDAPI vendor drivers, and it maps all
of them to one standard layout using `gamecontrollerdb`. That is also the database libmanette
itself consumes. A backend with only one of the two paths loses a class of controllers.

### Measured: which mechanisms work in the process shape GJS has

[`docs/poc/gamepad-darwin-probe.m`](../poc/gamepad-darwin-probe.m) runs each mechanism in a
**non-bundled CLI process driving a GMainLoop**. That is what `gjs` is: no `.app`, no
`NSApplication`, a `GMainContext` instead of a CFRunLoop. ADR 0022 showed that this shape can
silently break Apple frameworks. Results on macOS 27.0 (26A428), arm64, no controller
attached:

| # | case | result |
|---|---|---|
| 1 | block queued on the **main dispatch queue**, bare GMainLoop for 300 ms | did **NOT** run; ran after one `CFRunLoopRunInMode` drain |
| 2 | GCF: `shouldMonitorBackgroundEvents`, observe `GCControllerDidConnectNotification`, `controllers` | 0 controllers; 20 cycles, no crash, `leaks`: **0 leaks** |
| 3 | IOKit: `IOHIDManager` on a **private dispatch queue** (GamePad/Joystick/MultiAxis usages) | open `kIOReturnSuccess` in an unsigned, unbundled process; 0 devices; cancel handler ran; 20 cycles; **0 leaks** |
| 4 | SDL 3.4.16 (Homebrew): `SDL_Init(SDL_INIT_GAMEPAD)`, `SDL_GetGamepads`, `SDL_UpdateGamepads` driven from a GLib timeout, `SDL_Quit` | init ok in 22 ms; 0 gamepads; 20 cycles; **0 leaks** |

Row 1 matters most. GCF calls its handlers on `GCController.handlerQueue`, and Apple
documents the main queue as its default. A GMainLoop never services that queue. So a GCF
backend in a GJS process gets no connect notification and no input unless someone drains
the CFRunLoop. It is the same failure ADR 0022 measured for `WKWebView`, and it has the same
fix: the pump that `@gjsify/webkit-native` already ships. Rows 2–4 show that every mechanism
initialises, enumerates zero devices and tears down cleanly in this process shape.

**Not measured:** input from a real device. No controller was attached, and no CI runner has
one. Every "works" above is the zero-device path.

GJS has no FFI, so every option below needs native code. The repo already has an
Objective-C + GI + prebuild pipeline for darwin: `@gjsify/webkit-native`, with meson, a
header-only GIR scan, `stage-prebuild.mjs`, `relocate-macho.mjs` and the
`build-prebuilds-macos` job.

## Options

**A. Port libmanette.** Rejected. It is a libevdev port first, and upstream has never
considered macOS (0 of 51 issues and 155 MRs; see `open-todos`).

**B. A GCF-only Objective-C shim.** Rejected. It loses every HID device GCF does not claim,
which is why WebKit and SDL both add IOKit. It also needs the main-queue drain (row 1) and
`shouldMonitorBackgroundEvents`, because GCF otherwise delivers input only to the foreground
app, and a `gjs` script never is one.

**C. Our own GCF + IOKit shim.** Viable (rows 2 and 3), but it rewrites what SDL already
maintains: the two-path arbitration (WebKit's `willHandleVendorAndProduct` allow-list), the
per-vendor HID report parsers, and a mapping database to reach the standard layout. It would
also be darwin-only, and Windows has the same gap.

**D. SDL3 behind a GObject shim.** SDL3 is zlib-licensed, has no dependencies beyond system
frameworks (`otool -L` on Homebrew's `libSDL3.0.dylib`), and already covers GCF, IOKit and
HIDAPI with `gamecontrollerdb`. The same C source also builds for Windows (XInput, RawInput,
WGI). Its gamepad API reports the standard layout directly: `SDL_GamepadButton` SOUTH, EAST,
WEST, NORTH, the shoulders, BACK, START, the stick clicks, the four d-pad buttons and GUIDE
are W3C buttons 0–5 and 8–16 one-for-one, and the triggers are axes that become analog
buttons 6 and 7. Row 4 shows it initialises cleanly in the GJS process shape.

## Decision

**D**, in four stages. Each stage lands on its own and says what it does not do yet.

### 1. A device-source seam in `@gjsify/gamepad` (implemented with this ADR)

`GamepadManager` used to be the libmanette binding: Manette signals, kernel `BTN_*` codes and
hat axes were handled inline next to the W3C slot logic. It is now split:

- `src/source.ts` defines `GamepadSource`: `start(sink)`, `stop()`, an optional `poll()`,
  plus a `name` and `startRequirements` for diagnostics. It also defines
  `GamepadSourceSink` (`connected`, `disconnected`, `button(index, value, pressed)`,
  `axis(index, value)`), and the sink speaks the **W3C standard mapping**. Each backend's
  vocabulary stays inside its source, so the manager has one copy of index selection, state,
  snapshots and events however many backends exist.
- `poll()` is there because SDL is a **pull** backend. The manager calls it at the top of
  every `getGamepads()`, which is exactly the W3C polling moment. Manette is a push backend
  and omits it.
- `src/manette-source.ts` holds everything Manette-shaped, unchanged in behaviour.
- `new GamepadManager({ source })` takes a source directly. That is how the manager is now
  tested with no controller and no typelib (`src/source.spec.ts`), and how an embedder with
  its own input stack can use it.

### 2. darwin answers `absent`, honestly, until the shim ships (implemented with this ADR)

The backend probe branches on the host OS (`@gjsify/utils/core`'s `hostOs()`). On darwin it
does **not** import `gi://Manette`. That import could only fail, and its failure text would
send a Mac user to a Linux package manager. The probe returns `absent` with a darwin-specific
one-time diagnostic that names this ADR, and `hasGamepadBackend()` stays `false`.

A stand-in that reports success with zero devices is explicitly **not** allowed. It would
make `hasGamepadBackend()` lie on exactly the host where it matters. An unknown host (no
`process` global to ask) keeps the Manette probe, which classifies itself from the loader's
own error. `package.json` now declares `gjsify.os` (`darwin: "none"`, `win32: "none"`, with
reasons), because the package branches on the OS (ADR 0018).

### 3. `@gjsify/gamepad-native`: a C shim over a statically linked SDL3 (open)

- **A new package with per-target siblings** `@gjsify/gamepad-native-darwin-{arm64,x64}`,
  following ADR 0017. The first publish of those three names is the manual Trusted-Publisher
  bootstrap. That is one reason stage 3 is its own PR.
- **C, not Objective-C.** SDL's API is C. The shim is `meson` + `gnome.generate_gir` from the
  header, as `webkit-native` does. The `objc` language is needed only if the CFRunLoop pump
  (below) is written against Foundation rather than CoreFoundation's C API.
- **Its own GI namespace, `GjsifyGamepad-1.0`, not `Manette`.** ADR 0022 reused `WebKit`
  because `@gjsify/iframe` could not carry a seam: a `gi://` seam needs top-level await, and
  that deadlocked `@gjsify/unit`. Neither reason applies here. `@gjsify/gamepad` already
  loads its backend lazily by dynamic `import()`, and Manette's API is shaped around kernel
  codes that the shim would have to fake. The seam from stage 1 is where the choice is made.
- **SDL3 linked statically, subsystems limited to joystick, gamepad, haptic and HIDAPI**, from
  a pinned SDL release built in the prebuild job. The Homebrew dylib also links AppKit, Metal,
  AVFoundation, CoreMedia and CoreAudio for subsystems a gamepad never uses. It is not in any
  GTK-runtime bundle. And `relocate-macho.mjs` reserves an `@loader_path` slot that no
  prebuild uses yet. The zlib notice goes into `docs/attribution.md`.
- **Surface** (sketch, fixed in stage 3's own review): `GjsifyGamepad.Monitor` with
  `device-added` / `device-removed` signals and `update()`, and `GjsifyGamepad.Device` with
  `get_name()`, `get_button(SDL button)`, `get_axis(SDL axis)`, `rumble(low, high, ms)` and
  `has_rumble()`.
- **Driving model.** `update()` calls `SDL_UpdateGamepads()` and drains
  `SDL_EVENT_GAMEPAD_ADDED` / `REMOVED`. The JS source calls it from `poll()`. While a
  monitor is live, a low-rate GLib timeout on the thread-default main context also calls it,
  so `gamepadconnected` fires for a page that has not polled yet. The same tick drains the
  CFRunLoop's default mode once (row 1), because without that SDL's GCF driver never hears
  about a GCF-only controller. This mirrors `gjsify_webkit_pump_run_loop`.
  `SDL_HINT_JOYSTICK_ALLOW_BACKGROUND_EVENTS=1` is set before `SDL_Init`, because a `gjs`
  process is never the foreground app.
- **One thread.** `SDL_Init`, `update()` and `SDL_Quit` all run on the thread that owns the
  JS context. SDL's IOKit driver schedules its `IOHIDManager` on the run loop of the thread
  that called `SDL_Init`, in a private mode it drains itself inside the update, so IOKit
  hotplug needs no pump from us. Only GCF's main-queue delivery does (row 1), and a `gjs`
  script's JS thread is the main thread, which is where that drain has to happen.
- **Deployment floor** is the one ADR 0074 declares for every darwin binary.

### 4. `sdl-source.ts` and the darwin branch goes live (open)

A `GamepadSource` over `gi://GjsifyGamepad`, with the SDL → W3C table as its own vocabulary
(a second table, not new rows in the evdev one). Values are scaled from int16 to -1..1, and
triggers from 0..32767 to 0..1 with `pressed` above `TRIGGER_PRESS_THRESHOLD`. Rumble maps to
`dual-rumble`. The darwin branch of the probe then imports `gi://GjsifyGamepad` and classifies
its load failures exactly as the Manette branch does (absent vs. fault). `gjsify.os.darwin`
moves to `supported` only after a **hardware check**: a real controller connects, reports
input and disconnects under `gjs` on macOS. The PR that flips it records that check.

## Consequences

- Linux behaviour is unchanged: it is the same libmanette code, moved behind the seam, and the
  suite that covers it now drives it through a fake Manette namespace too.
- The manager's state handling has its first tests. It had none before, because no runner has
  a controller.
- The Manette-1 migration (`open-todos`) becomes a new `ManetteSource`, and the manager does
  not change.
- Windows gets a decided path, but not a decision. The shim is portable C over a portable
  library, and a `win32-x64` target is a later, separate call. It would take the per-target
  sibling shape ADR 0073 gives win32 (`@gjsify/gamepad-native-win32-x64`), and its consumer is
  Node + `@gjsify/node-gi`, since Windows has no GJS host
  ([ADR 0024 § 4](0024-ship-installable-artifacts.md)). The CFRunLoop drain is darwin-only;
  whether SDL's RawInput/WGI drivers need anything from that process shape is unmeasured.
- Cost: one statically linked SDL3 and three new published package names. It is expected to
  be smaller than Homebrew's 2.5 MB dylib, since only the input subsystems are compiled in;
  stage 3 measures it.

## Verification without hardware

- Stage 1: `src/source.spec.ts` drives the manager through a scripted source (index
  selection, standard-layout state, events, pull polling, stop/restart, start faults) and the
  Manette adapter through a fake namespace. `src/backend.spec.ts` pins the darwin branch:
  `absent`, no Manette import, one darwin-specific diagnostic from the use site.
- Stage 3: the shim's own suite asserts, under `gjs` on the macOS leg, what the PoC asserts in
  C: it initialises, enumerates zero devices, tears down, and repeated cycles leak nothing.
- Stage 4: the hardware check above. Until then the claim stays `none`/`partial`, and it
  says why.

## Amendment 1, 2026-09-25 — SDL3 is the ONE gamepad backend, on every OS

Decided by the maintainer after the stage-1 review. The text above is left as written; where
this section and the text above disagree, this section wins.

### What changes

1. **SDL3 becomes the only gamepad backend on all three OSes** — darwin, linux and win32 —
   not a darwin special case next to libmanette. One C shim (`@gjsify/gamepad-native`,
   namespace `GjsifyGamepad-1.0`) is built per target from the same source, and one
   `SdlSource` in `@gjsify/gamepad` drives it everywhere. The "Windows gets a decided path, but
   not a decision" consequence above is superseded: win32 takes the same package, as the
   per-target sibling `@gjsify/gamepad-native-win32-x64` in ADR 0073's shape.
2. **Statically linked and trimmed.** Kept: joystick + gamepad, events (the joystick
   subsystem requires it), haptic, sensor (controller gyro/accelerometer) and HIDAPI (SDL's
   own vendor drivers). Disabled: video, render, GPU, audio, camera, dialog, tray, power and
   libusb. Built `SDL_SHARED=OFF`, `SDL_STATIC=ON`, from a pinned SDL release. The runtime
   dependencies are the OS and nothing else:
   - darwin: system frameworks and `/usr/lib` only;
   - win32: system DLLs only;
   - linux: libc, libm, libdl and pthread. libudev and D-Bus are reached only through SDL's own
     optional `dlopen`, and without libudev SDL falls back to inotify on `/dev/input`. So no
     `.so` beyond libc is a load-time need, and a host without udev still enumerates devices.
3. **No Steam Input.** It is proprietary and needs a running Steam client. SDL already carries
   Valve's HIDAPI drivers and the `gamecontrollerdb` mapping database, which is the part of
   that stack a standard layout needs.
4. **Linux migrates in two steps, and libmanette leaves only after a measurement.** First the
   SDL source runs alongside `ManetteSource` on Linux and the two are compared on the same
   controllers. `ManetteSource` and the libmanette dependency are deleted once the SDL source
   is proven on Linux with real controllers — not before, and not on the strength of the
   zero-device path CI can run. Until then Linux behaviour stays libmanette's. This also
   retires the `Manette-1` migration in `status/open-todos.md`: there is no reason to port a
   backend that is being removed.
5. **WebHID is a noted future option, not implemented.** The same static HIDAPI build exposes
   `SDL_hid_*`, which is what `navigator.hid` would sit on. Its permission model —
   `requestDevice()` answered by a GTK chooser, or by application configuration — needs its own
   decision before any code.
6. **SDL3 is not adopted for anything else.** Video, audio, camera and power stay on
   GTK, GLib and GStreamer. That follows the simplicity rule (AGENTS.md § Governance): the
   gamepad adoption lets us DELETE libmanette and a second Linux-only backend, while a broad
   adoption would delete nothing and add a second copy of subsystems we already have.

### What it means for the stages

- **Stage 3** (`@gjsify/gamepad-native`) keeps its shape — C shim, `gnome.generate_gir` from
  the header, own namespace, per-target siblings — and gains linux and win32 legs built from
  the same source. The shim adds a `sensor` read and trigger rumble to the sketched surface,
  because the kept subsystems make both free. The CFRunLoop drain stays darwin-only.
- **Stage 4** (`SdlSource`) is written once. darwin switches to it when the native package
  is present, and win32 does the same when its leg lands. On Linux it runs next to
  `ManetteSource` as described in point 4. `gjsify.os.<os>` changes per OS, after that OS's
  hardware check.
- **Cost.** Three published names become one bridge plus one per declared target, and each
  new target needs its own first-publish bootstrap. The measured size of the static build is
  recorded by the PR that first builds it (stage 3).

### Stage 3 and 4 on darwin — what was built, and the measurement

Built in `packages/web/gamepad-native` (C shim, meson) and `packages/web/gamepad/src/sdl-source.ts`.
Three things the sketch above left open were settled while building it:

- **The SDL → W3C table lives in C, not in `sdl-source.ts`.** The shim's snapshot is already
  17 button values and 4 axis values in W3C order, so the table exists once for every OS and
  every JS host (GJS, and Node through node-gi), and a poll is two GI calls per device rather
  than one per control. `sdl-source.ts` decides only `pressed` (the triggers are analog,
  with the shared threshold) and forwards only what changed, so `Gamepad.timestamp` advances
  only on new data, as W3C says it should.
- **Hotplug is a diff of `SDL_GetGamepads()` against the tracked set, not SDL's event
  queue.** That keeps two monitors from stealing each other's events. `update()` flushes
  the joystick/gamepad event range so the queue cannot grow.
  `SDL_HINT_NO_SIGNAL_HANDLERS=1` is set too: without it SDL's events subsystem takes over
  SIGINT/SIGTERM and the host stops reacting to Ctrl-C.
- **SDL is pinned as a meson `wrap-file`** (`subprojects/sdl3.wrap`: SDL 3.4.16 release
  tarball, sha256) and built through meson's CMake module. The module drops SDL's
  `$<LINK_LIBRARY:FRAMEWORK,…>` link list, so the frameworks are named in `meson.build`.
  That turns out to be a guard for free: re-enabling a trimmed subsystem fails the link
  instead of quietly adding a framework to the runtime dependencies. Only `gjsify_gamepad_*`
  is exported, which keeps SDL's symbols private and lets `-dead_strip` remove what the shim
  never reaches.

Measured on macOS 27.0 (26A428), arm64, `MACOSX_DEPLOYMENT_TARGET=15.0`, `buildtype=minsize`,
after `stage-prebuild.mjs`:

| | |
|---|---|
| `libgjsifygamepad.dylib` | **1,453,264 bytes** (1.39 MiB); `__TEXT` 1,081,344. For comparison, Homebrew's full `libSDL3.0.dylib` 3.4.16 is 2,520,256 bytes and links 22 libraries |
| typelib + GIR | 3,040 + 27,567 bytes |
| `minos` | 15.0 |
| `otool -L` | CoreFoundation, Foundation, IOKit, ForceFeedback, GameController, CoreHaptics, CoreServices (all `/System/Library/Frameworks`), `/usr/lib/libobjc.A.dylib`, `/usr/lib/libSystem.B.dylib`, plus `@rpath/libglib-2.0.0.dylib` and `@rpath/libgobject-2.0.0.dylib`, which are the GObject shim's own dependencies and are resolved from the host's GLib like every other bridge's. No AppKit, Metal, AVFoundation, CoreAudio or CoreMedia |
| tests | `meson test`: C lifecycle (20 cycles, two monitors, dispose without close), the same under `gjs` through the typelib, and `leaks --atExit` → **0 leaks** (a deliberately leaked monitor makes it fail) |

The darwin branch of the probe now imports `gi://GjsifyGamepad`. A host without the prebuild
still answers an honest `absent`, now with advice about the prebuild and the typelib path
instead of the ADR, and `gjsify.os.darwin` is `partial` until the hardware check.


### Stage 3 and 4 on linux and win32 — what was built, and the measurement

The same C source and `meson.build` now build for `linux-x64`, `linux-arm64` and
`win32-x64` (`@gjsify/gamepad-native-<target>`). What the darwin notes left open was
settled as follows:

- **Linux keeps SDL private** with `--exclude-libs,ALL` and a version script, because ELF
  has one flat namespace. `SDL_DEPS_SHARED` keeps libudev and D-Bus out of `DT_NEEDED`;
  SDL also needs `SDL_UNIX_CONSOLE_BUILD=ON`, or it refuses to configure without X11 or
  Wayland headers even with video off.
- **win32 keeps DirectInput.** SDL checks `dinput.h` only inside `if(SDL_DIRECTX)`,
  which needs audio or video; left alone, the DirectInput joystick and haptic drivers
  compile out without a word, and every generic HID pad that is neither XInput nor a
  HIDAPI vendor controller disappears. `HAVE_DINPUT_H=1` is supplied and `dinput8` (an
  OS DLL) linked. The GIR is scanned on Linux and compiled beside the DLL, as for
  `webview2-native`; the API is exported through a `dllexport` macro in the header.
- **The Windows message pump.** From SDL 3.4's source: `SDL_Init` creates one
  message-only helper window (DirectInput's cooperative-level HWND, `DefWindowProc`) on
  the calling thread, and the joystick driver runs device notification and raw input on
  its own thread with its own `GetMessage` loop (`SDL_HINT_JOYSTICK_THREAD`, default on).
  XInput and HIDAPI are polled from `SDL_UpdateGamepads()`. `test/win32-message-queue.c`
  measures what is left on a thread that never pumps, as in a GLib process; its CI
  result is recorded below.
- **The Linux switch.** `@gjsify/gamepad` keeps libmanette as the Linux default.
  `GJSIFY_GAMEPAD_BACKEND=sdl` uses the shim; `=compare` runs the shim beside libmanette
  on the same controllers (`ComparingSource`) and reports every disagreement that holds
  for two polls. win32 probes the shim like darwin.

Measured on Fedora 44 x86-64 (local build, `buildtype=minsize`):

| | |
|---|---|
| `libgjsifygamepad.so` | 1,767,360 bytes as linked (1,457,608 after `strip --strip-unneeded`) |
| `readelf -d` NEEDED | `libglib-2.0.so.0`, `libgobject-2.0.so.0`, `libm.so.6`, `libc.so.6`; exports: 21 symbols, all `gjsify_gamepad_*` |
| valgrind | 0 bytes lost at 1 and at 20 cycles; reachable 16,223 B / 84 blocks both times. A source leaked in `close()` makes it grow (+38 blocks) and fail |
| uinput | a virtual Xbox 360 pad connects, reports A, the left stick and the left trigger, and disconnects through SDL's evdev driver; swapping two rows of the W3C table fails it |
| a real controller | an 8BitDo N30 Pro 2 over Bluetooth (`2dc8:2865`) enumerates in both backends with the same name; SDL uses its **evdev** driver (no HIDAPI marker in the GUID; `/dev/hidraw*` is root-only on this host) and reports no rumble, as libmanette does. Until the pad sends its first report, the kernel holds its axes at 0 of 0..255, which SDL reports as -1 and libmanette does not report at all; `compare` shows it |
| the first comparison | Pascal's 20 s recording on that pad: the same buttons in both backends, except that only SDL reports Home (libmanette's own mapping for this GUID has no `guide`); SDL − libmanette latency median 1.5 ms (SDL polled every 4 ms). It found a **libmanette-side bug in this package, not in either library**: `ManetteSource` read `get_absolute()` as SDL axis indices, but libmanette reports Linux codes (`rightx`→`ABS_RX` 3, `righty`→`ABS_RY` 4, `manette-mapping.c`). The right stick's X landed on W3C axis 3 and its Y on the left trigger, for every controller libmanette maps. Both libraries map this pad identically (the same gamecontrollerdb row, `rightx:a2,righty:a3` = `ABS_Z`/`ABS_RZ`); SDL's values were the right ones |
| the second recording | every button pressed and both sticks moved to every edge, with the fix above: 16 buttons identical in both backends, Home again only in SDL; left stick -1..1 in both; right X -0.20..1.00 in both (the same bytes, so a hand or hardware limit, not a backend); **right Y: SDL -1.00..0.31, libmanette nothing at all**; latency median 2.3 ms, max 4.0 ms. The dead axis is a **libmanette bug**, read in its source: the evdev backend passes the kernel CODE as `hardware_index` (0.2.13 `manette-evdev-backend.c`, unchanged on `main`), while a gamecontrollerdb `aN` is the N-th axis the device HAS — the ordinal SDL uses. The two agree only for pads whose axis codes have no gaps (xpad: X, Y, Z, RX, RY, RZ). This pad has X, Y, Z, RZ, GAS, BRAKE, so `righty:a3` asks for code 3 (`ABS_RX`, absent) and the real right Y (`ABS_RZ`, code 5) is taken for `a5`, the left trigger: libmanette's LT fires when the right stick is pushed down. SDL reads the same row correctly. Not yet explained: SDL's right Y stops at +0.31, and raw evdev during a recording would say whether that is the pad |
