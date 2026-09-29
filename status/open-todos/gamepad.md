<!-- Authored Open-TODO sections — area: @gjsify/gamepad.
     One `### <title>` per open item. A RESOLVED item is DELETED (its record is the
     commit + CHANGELOG that closed it). See status/open-todos/README.md for the
     full convention and where to add a new entry. -->

### `@gjsify/gamepad` on a platform without libmanette — OBSERVABILITY DONE, backend still missing

The observability half is closed. `packages/web/gamepad/src/backend.ts` is now the one place the
package decides whether a backend exists: `hasGamepadBackend()` (barrel-exported, answerable with no
monitor and no connected device, the `isSecureRandomSource()`/`hasNativeSab()`/`hasOcspSupport()`
pattern) and a SPLIT classification. The QUERY is silent and the diagnostic is emitted by the USE —
`GamepadManager._init()`, once per process — mirroring `isSecureRandomSource()` (pure) vs.
`fillRandomBytes()` (warns) in `@gjsify/webcrypto/random`; the recommended usage is to CALL the
predicate, so it must not cost a stderr line on every macOS/Windows start. Three outcomes, three
voices: **absent** = no `Manette` typelib, or no `@gjsify/node-gi` in a `--app node` process (a
supported configuration, so a warn naming what to install — not a fault), or `gi://` stubbed by
design on the `--app browser`/`--app nativescript` builds (nothing to install ⇒ SILENT, and on those
targets the runtime's own `navigator.getGamepads` is the implementation anyway); **fault** = a
library that will not `dlopen`, a version or ABI skew (`console.error` carrying the original);
**monitor fault** = everything past the probe (`new Monitor()`, the device walk, `connect()`) failing
on a host whose backend loaded fine — a sandbox without udev / `/dev/input` — which gets its own
report rather than being labelled a failed load.

`getGamepads()` answers the spec's `[[gamepads]]` and MUST NOT be made to throw: the list "is
initially the empty list" and grows only when an index is selected for a connected device, so a host
with no backend gets `[]` — the W3C steps only ever return a list (their one throw is the
`"gamepad"` permission-policy `SecurityError`), and a browser on a driverless machine answers
identically: WebKit compiles `EmptyGamepadProvider::platformGamepads()` returning a static empty
vector. Throwing would break `navigator.getGamepads().length`. The pre-filled four-slot array this
package used to return was CHROME's shape, and that is measured rather than assumed — one machine,
`about:blank`, no controller attached: Firefox `[]` (length 0) vs. Chromium `[null,null,null,null]`
(length 4). WebKit agrees with Firefox in source: `NavigatorGamepad::gamepads()` returns
`m_gamepads` unchanged when it `isEmpty()`. The four slots made `length` report four ports that do
not exist; they are gone.

The suite is runnable on a host with NO Manette typelib, and that is checked by running it there:
`bwrap --ro-bind / / --ro-bind <copy-of-girepository-1.0-minus-Manette> /usr/lib64/girepository-1.0
gjs -m test.gjs.mjs` → `138 completed`, identical to the same bundle on this machine WITH libmanette,
with the one-time "No gamepad backend on this host" line on stderr only in the first case. Keeping
that true is a constraint on the test bundle, not just on the source: `register.spec.ts` must not
reference `globalThis.GamepadEvent` / `globalThis.navigator`, because `--globals auto` reads those as
free globals and injects the GTK/GNOME-backed register set, which announces `gi://Gdk, gi://GdkPixbuf,
gi://Manette, gi://Pango, gi://PangoCairo at load`. Wiring an ad-hoc Manette-less CI leg is NOT
proposed here — the general answer is the per-namespace availability contract below.

Still measured, still true: no GTK-runtime bundle carries the Manette typelib or libmanette, so on
macOS and Windows that import has never succeeded. Deliberately NOT fixed by seeding libmanette into
the bundles. There is nothing to seed FROM: homebrew-core has no `libmanette` formula
(`formulae.brew.sh/api/formula/libmanette.json` → 404) and `GTK4_Gvsbuild_2026.6.0_x64.zip` contains
zero manette/evdev entries, so the seed pattern would match nothing and — with the typelib-symmetry
rule in place — a Manette typelib could not ship anyway. And a hypothetical port would not help:
libmanette's backend reads Linux `/dev/input/event*` via evdev/udev, so a `Manette.Monitor` on
macOS/Windows would enumerate nothing while satisfying every symmetry check. That is the same "looks
available, does nothing" shape, moved one layer down.

What is left is the BACKEND, and the generalisation. Same shape as the ten other namespaces the
workspace imports and no bundle ships (`gi://Gst` ×17, `gi://WebKit` ×4, `Soup`, `Gda`,
`JavaScriptCore`, `X`): the generalisable answer is a per-namespace availability contract — the
`backend.ts` probe (classify absent vs. broken, warn once, expose a `has*` capability) is the first
instance of it and is currently hand-rolled per package. The three concrete follow-ups are the next
three entries.


### The gamepad backend is SDL3 on every OS (ADR 0075 + Amendment 1); the shim itself is open

Decided in `docs/adr/0075-darwin-gamepad-backend-is-sdl3-behind-a-gobject-shim.md`: SDL3 behind
a GObject shim, reached through a device-source seam. **Landed with the ADR:** the seam
(`packages/web/gamepad/src/source.ts`; the libmanette code moved unchanged into
`manette-source.ts`; the manager's W3C state handling is now tested through a scripted fake source
in `source.spec.ts`, where before it had no test at all) and the honest darwin answer (the probe
branches on `hostOs()`, never imports `gi://Manette` on darwin, returns `absent` with a diagnostic
naming the ADR, and `gjsify.os.darwin` is declared `none`). `docs/poc/gamepad-darwin-probe.m`
measured the zero-device path on macOS 27 arm64: GCF, IOKit HID on a private dispatch queue and
SDL 3.4.16 all initialise, enumerate zero devices and tear down in a non-bundled GMainLoop process,
20 cycles each, `leaks` 0; and the main dispatch queue — where GCF delivers — is NOT serviced by a
bare GMainLoop. **Still open, in the order they gate each other:**

Amendment 1 (2026-09-25) widened the decision: SDL3 — static, trimmed to joystick/gamepad,
events, haptic, sensor and HIDAPI, runtime deps = the OS only — is the ONE backend on darwin,
linux and win32. No Steam Input; WebHID over the same HIDAPI build is a future option needing its
own permission decision; SDL3 is adopted for nothing else.

1. `@gjsify/gamepad-native` + `-darwin-arm64` / `-darwin-x64` (ADR 0017): the C shim, GI namespace
   `GjsifyGamepad-1.0`, SDL3 linked statically and trimmed as above, a CFRunLoop drain in its
   update tick (PoC row 1 — without it SDL's GCF driver never sees a GCF-only controller),
   `build-prebuilds-macos` wiring, and the first-publish bootstrap of the new names. Its own
   `gjs` suite on the macOS leg asserts what the PoC asserts in C.
2. `sdl-source.ts` with the SDL → W3C table, and the darwin branch importing `gi://GjsifyGamepad`
   with the same absent-vs-fault classification the Manette branch has.
3. The linux and win32 legs of the same shim (`-linux-<arch>`, `-win32-x64` in ADR 0073's shape).
   On Linux `SdlSource` runs ALONGSIDE `ManetteSource` first and the two are compared.
4. Hardware checks — per OS, a real controller (on macOS also a GCF-only one) connecting,
   reporting input and disconnecting — before `gjsify.os.<os>` moves. No runner has one.
5. After the Linux check: delete `ManetteSource`, `button-mapping.ts`'s evdev table and the
   libmanette dependency.

Why the ADR needs both Apple input paths (and so chose the library that already has both):

`GameController.framework` alone is NOT sufficient, and the reference implementations both say so by
shipping two paths. WebKit's `Source/WebCore/platform/gamepad/` holds `cocoa/`
(`GameControllerGamepadProvider.mm`) AND `mac/` (`HIDGamepadProvider.mm`, plus per-device
`Dualshock3HIDGamepad` / `StadiaHIDGamepad` / `LogitechGamepad` / `GenericHIDGamepad`), combined by
`mac/MultiGamepadProvider.mm` — which calls `HIDGamepadProvider::ignoreGameControllerFrameworkDevices()`
and gates GCF on `GameControllerGamepadProvider::willHandleVendorAndProduct()`, a hardcoded
vendor/product allow-list. The comment that explains the allow-list is narrower than "GCF is too
aggressive" in general — verbatim, and note its first three words
(`cocoa/GameControllerGamepadProvider.mm:104`, inside
`#if HAVE(MULTIGAMEPADPROVIDER_SUPPORT) && !HAVE(GCCONTROLLER_HID_DEVICE_CHECK)`): *"On macOS 10.15,
we use GameController framework for some controllers, but it's much too aggressive in handling devices
it shouldn't. So we check Vendor/Product against an explicit allow-list to determine if we should let
GCF handle the device. (We have the opposite check in HIDGamepadProvider, as well)"*. So the
allow-list is the fallback for builds without the newer HID-device check, not a standing verdict on
GCF. The conclusion — a darwin backend needs BOTH paths — does not rest on that comment: it rests on
`mac/MultiGamepadProvider.mm` existing and driving both providers
(`HIDGamepadProvider::singleton().ignoreGameControllerFrameworkDevices()`), and on the per-device HID
classes next to it. SDL ships both paths too —
`src/joystick/apple/SDL_mfijoystick.m` (GameController/MFi) and
`src/joystick/darwin/SDL_iokitjoystick.c` (IOKit HID).

Second, larger piece of work: `packages/web/gamepad/src/button-mapping.ts` maps raw evdev codes
(`BTN_SOUTH: 304` … `BTN_DPAD_RIGHT: 547`, the kernel `linux/input-event-codes.h` constants
libmanette 0.2 actually transmits) to W3C indices. Nothing on macOS produces those numbers — GCF
gives named `GCControllerButtonInput` properties, IOKit gives HID usage pages — so a darwin backend
needs a SECOND source vocabulary mapped to the same `W3CButton`/`W3CAxis` targets, not a new row in
the existing table. The seam puts that vocabulary inside its own `GamepadSource` (step 2 above).
`hasGamepadBackend()` returning `false` is the honest interim answer.


### libmanette is not portable and upstream has never considered it

Verified against `gitlab.gnome.org/GNOME/libmanette` (tag `0.2.13` and `main`):

- `meson.build` has `libevdev = dependency('libevdev', version: '>= 1.4.5')` and
  `hidapi = dependency('hidapi-hidraw')` — neither carries a `required:` argument, so both are hard.
  The only toggle in `meson_options.txt` under "Dependencies" is `gudev`.
- there is no `host_machine` conditional in ANY `meson.build` in either revision (checked all six in
  `0.2.13`, all of `main`).
- `hid_enumerate()` is never called anywhere in the tree. `manette-hid-backend.c` does
  `hid_open_path(self->filename)`, and `filename` comes from the monitor's gudev walk
  (`manette-monitor.c`: `g_udev_client_new({"input", "hidraw"})`,
  `g_udev_device_get_device_file()`, `DEV_DIRECTORY "/hidraw"` prefix test). So the hidapi backend
  only ever receives `/dev/hidraw*` paths a Linux-only monitor found — hidapi being cross-platform
  buys nothing.
- all 51 issues and 155 merge requests (GitLab API `x-total`, tracker open since 2017-12-03) scanned
  for macos / mac os / darwin / osx / portab* / windows / win32 / freebsd / cross-platform in title
  and description: **zero relevant hits** in nine years (the one keyword match, MR !104, is a
  comment about SDL button mappings).

And the dependency it hard-requires is not available: homebrew-core's `libevdev` formula carries
`depends_on :linux` with `arm64_linux`/`x86_64_linux` bottles only, MacPorts has no `libevdev` port
(ports API exact-name query → `{"count":0}`), and nixpkgs declares
`platforms = lib.platforms.linux ++ lib.platforms.freebsd`. Porting libmanette is therefore a
libevdev port first; that is why the darwin work above is a NEW backend, not a build fix.


### The `Manette-1` migration is superseded (ADR 0075 Amendment 1)

Not to be done: libmanette is being REMOVED (step 5 of the entry above), so porting to its 1.0 API
would be work on a backend with an end date. Kept for the record of what 1.0 changes, in case the
Linux SDL comparison fails and the decision is revisited.


libmanette `main` is `version: '1.0.alpha'` with `libmanette_api_version = '1'`, i.e. the typelib
becomes `Manette-1` and `@gjsify/gamepad`'s current `gi://Manette` (0.2) namespace is a different
one. The API is not source-compatible:

- `ManetteEvent` is DELETED (`src/manette-event.c` + `manette-event-private.h` removed in commit
  `3255105` "Remove ManetteEvent", part of MR !126 "Bump API version and revamp API", merged
  2025-04-01). Every `event.get_button()` / `get_absolute()` / `get_hat()` call in
  `gamepad-manager.ts` goes away with it.
- the device signals are renamed and re-typed: `button-pressed` / `button-released` /
  `absolute-axis-changed` (plus `unmapped-*` variants) instead of
  `button-press-event` / `button-release-event` / `absolute-axis-event` / `hat-axis-event`.
- typed `ManetteButton` / `ManetteAxis` enums (`src/manette-inputs.h`,
  `MANETTE_BUTTON_DPAD_UP` … `MANETTE_BUTTON_TOUCHPAD`, `MANETTE_AXIS_LEFT_X` …
  `MANETTE_AXIS_RIGHT_TRIGGER`) replace the raw kernel codes — which is exactly what
  `button-mapping.ts`'s `LinuxButton` table exists to decode, so that table is retired rather than
  extended. Note there is no `hat-axis` signal any more: the d-pad is four buttons.

`@girs/manette-0.2` does not bind the `Manette-1` namespace, so this needs a `ts-for-gir` run for the
new version before any code change. Independent of the macOS work above and independent of the
observability fix already landed: the migration is required on Linux the moment distros ship 1.0.

