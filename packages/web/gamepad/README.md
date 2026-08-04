# @gjsify/gamepad

The W3C Gamepad API for GJS, backed by libmanette 0.2. Provides `navigator.getGamepads()` polling, `Gamepad`, `GamepadButton`, `gamepadconnected`/`gamepaddisconnected` events, and dual-rumble haptics via `GamepadHapticActuator`. The Manette monitor is lazily initialised on the first `getGamepads()` call.

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

## Platform support — hosts without libmanette

The backend is libmanette, and libmanette is Linux-only: it links `libevdev` unconditionally (`dependency('libevdev')` in its `meson.build`, with no `required:` argument and no `host_machine` branch anywhere in the tree), and libevdev is packaged for Linux and FreeBSD only — homebrew-core's formula carries `depends_on :linux`, MacPorts has no port, nixpkgs declares `platforms = linux ++ freebsd`. **So on macOS and Windows there is no gamepad backend at all, and there cannot be one until a native backend is written.** That is a platform gap, not a bug in this package.

On such a host `navigator.getGamepads()` returns its list with every slot `null` *because there is no backend* — indistinguishable, from the return value alone, from a Linux host with nothing plugged in. That is deliberate, and it is what the spec asks for: `getGamepads()`'s steps only ever return a list (their one `throw` is a `SecurityError` for the `"gamepad"` permission policy), and a browser on a machine with no gamepad driver returns exactly the same empty answer — WebKit compiles an `EmptyGamepadProvider` for precisely that case. Making the call throw would break every page that polls `navigator.getGamepads().length`.

Ask the capability export instead of guessing from an empty list:

```typescript
import { hasGamepadBackend } from '@gjsify/gamepad';

if (!(await hasGamepadBackend())) {
    // No gamepad subsystem on this host — hide the controller UI rather than
    // showing "no controller connected" forever.
}
```

`hasGamepadBackend()` needs no monitor and no connected device. When it is `false` because the typelib is absent, the package also says so once on stderr, naming what to install. Every *other* load failure — a shared library that will not `dlopen`, a version or ABI skew, `@gjsify/node-gi` not installed on the node target — is reported separately, at `error` level and carrying the original error. A broken setup is a fault, not a platform gap, and the two must not look alike.

## License

MIT
