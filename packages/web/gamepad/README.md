# @gjsify/gamepad

The W3C Gamepad API for GJS. Provides `navigator.getGamepads()` polling, `Gamepad`, `GamepadButton`, `gamepadconnected`/`gamepaddisconnected` events, and rumble via `GamepadHapticActuator`. The backend is SDL3 on macOS and Windows, through [`@gjsify/gamepad-native`](../gamepad-native/README.md), and libmanette 0.2 on Linux until SDL has been compared against it there; it starts lazily on the first `getGamepads()` call.

Part of the [gjsify](https://github.com/gjsify/gjsify) project — Node.js and Web APIs for GJS (GNOME JavaScript).

## Installation

```bash
gjsify install @gjsify/gamepad

# npm or yarn also work (e.g. adding it to an existing project):
npm install @gjsify/gamepad
yarn add @gjsify/gamepad
```

## Usage

```typescript
import { GamepadManager, GamepadEvent } from '@gjsify/gamepad';

// Start monitoring connected gamepads
const manager = new GamepadManager();

window.addEventListener('gamepadconnected', (e) => {
    const event = e as GamepadEvent;
    const pad = event.gamepad;
    console.log(`Connected: ${pad.id}, buttons: ${pad.buttons.length}`);
});

window.addEventListener('gamepaddisconnected', (e) => {
    console.log(`Disconnected: ${(e as GamepadEvent).gamepad.id}`);
});

// Poll the current state
const gamepads = navigator.getGamepads();
for (const pad of gamepads) {
    if (pad) console.log(pad.axes, pad.buttons.map((b) => b.pressed));
}
```

`vibrationActuator` follows the spec on both backends: parameters default to 0, an
out-of-range one rejects with `TypeError`, an effect the pad lacks with
`NotSupportedError`. `playEffect()` resolves `'complete'` once the effect has played
(`startDelay + duration`, at most 5 s), or `'preempted'` when a later `playEffect()` or
`reset()` interrupts it.

## Platform support

| host | backend | status |
|---|---|---|
| Linux | libmanette 0.2 (`gi://Manette`) by default; the SDL3 shim with `GJSIFY_GAMEPAD_BACKEND=sdl`, or both with `=compare` | supported (libmanette); the shim reads a virtual uinput pad in CI |
| macOS | SDL3 behind a GObject shim (`gi://GjsifyGamepad`, `@gjsify/gamepad-native`) | partial: builds, loads and enumerates; input from a real controller not yet verified |
| Windows | the same shim, from Node through `@gjsify/node-gi` | partial: builds, loads, and reads a virtual XInput pad in CI; a real controller not yet verified |

The decision is [ADR 0075](../../../docs/adr/0075-darwin-gamepad-backend-is-sdl3-behind-a-gobject-shim.md) and its Amendment 1: SDL3, statically linked and trimmed to the input subsystems, becomes the one backend on every OS, and replaces libmanette on Linux once it has been compared against it there with real controllers. libmanette itself cannot move: it links `libevdev` unconditionally, and libevdev is packaged for Linux and FreeBSD only.

On macOS and Windows the typelib and library come from the per-target optional dependency `@gjsify/gamepad-native-<os>-<arch>`, and a process finds them through `gjsify run`, which puts every installed prebuild on `GI_TYPELIB_PATH` (and, on Windows, on `PATH`). Neither probes for libmanette.

### Comparing the two Linux backends

Amendment 1 removes libmanette only after the SDL3 shim has been compared against it on real controllers. `GJSIFY_GAMEPAD_BACKEND` selects the backend per process on Linux (macOS and Windows ignore it):

| value | the page sees | what else happens |
|---|---|---|
| unset / `manette` | libmanette | — |
| `sdl` | the SDL3 shim | — |
| `compare` | libmanette | the shim runs beside it on the same controllers; connects, disconnects and every control on which the two disagree for more than one poll go to stderr, prefixed `[@gjsify/gamepad compare]` |

Controllers are paired by connection order. A difference of up to 0.02 is scaling, not disagreement: libmanette normalises the evdev range, SDL rescales to int16 first. One difference is expected and is not a control: the two name the same pad differently (`Gamepad.id`), because SDL takes the name from its mapping database and libmanette from the kernel.

A host with no backend — Linux without libmanette, macOS or Windows without the prebuild — is a platform gap, not a bug in this package, and it is reported, not hidden. There, `navigator.getGamepads()` returns the **empty list** *because there is no backend* — indistinguishable, from the return value alone, from a Linux host with nothing plugged in. That is deliberate, and it is what the spec asks for: `Navigator.[[gamepads]]` "is initially the empty list" and grows only when an index is selected for a connected device, so `getGamepads()`'s steps only ever return a list (their one `throw` is a `SecurityError` for the `"gamepad"` permission policy), and a browser on a machine with no gamepad driver returns exactly the same empty answer — WebKit compiles an `EmptyGamepadProvider` for precisely that case. Making the call throw would break every page that polls `navigator.getGamepads().length`.

Ask the capability export instead of guessing from an empty list:

```typescript
import { hasGamepadBackend } from '@gjsify/gamepad';

if (!(await hasGamepadBackend())) {
    // No gamepad subsystem on this host — hide the controller UI rather than
    // showing "no controller connected" forever.
}
```

`hasGamepadBackend()` needs no monitor and no connected device, and it is **quiet**: asking the question prints nothing, so the recommended usage above costs no stderr line on a macOS or Windows start. The one-time explanation comes from the *use* instead — the first `getGamepads()` that actually wanted a monitor:

* **no backend** (no Manette typelib; no `@gjsify/gamepad-native` prebuild on macOS or Windows; or `@gjsify/node-gi` not installed on the node target) → one `console.warn` naming what to install.
* **a fault** (a shared library that will not `dlopen`, a version or ABI skew) → one `console.error` carrying the original error. A broken setup is a fault, not a platform gap, and the two must not look alike.
* **the monitor fails to start** after the backend loaded (no udev or `/dev/input` in a sandbox; flatpak: `--device=input`) → its own `console.error`, because that is a third, distinct failure.

## Driving the manager from your own device source

`GamepadManager` reads devices through a `GamepadSource`: an object with `start(sink)`, `stop()` and an optional `poll()`, which reports `connected` / `disconnected` / `button` / `axis` in the W3C standard layout. Hand one to the constructor to test gamepad handling with no controller attached, or to feed input you already own:

```typescript
import { GamepadManager, type GamepadSource, type GamepadSourceSink } from '@gjsify/gamepad';

const pad = { id: 'Scripted Pad', vibrationActuator: null };
let sink: GamepadSourceSink | null = null;
const source: GamepadSource = {
    name: 'scripted',
    start: (s) => { sink = s; s.connected(pad); },
    stop: () => { sink = null; },
};

const manager = new GamepadManager({ source });
manager.getGamepads();          // starts the source: [Gamepad { id: 'Scripted Pad', index: 0, … }]
sink!.button(pad, 0, 1, true);  // standard button 0 (A / Cross) pressed
```

On the browser and NativeScript targets the runtime's own Gamepad API is the implementation (`gjsify.runtimes` declares both `native`): the package root routes to `globals.mjs`, whose `hasGamepadBackend()` reports that native surface, and `@gjsify/gamepad/register` leaves an existing `navigator.getGamepads` untouched rather than replacing it.

## License

MIT
