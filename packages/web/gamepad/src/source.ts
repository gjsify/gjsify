// The device-source contract — the seam between a platform's gamepad subsystem and the
// W3C state `GamepadManager` keeps. Decided in ADR 0075
// (docs/adr/0075-darwin-gamepad-backend-is-sdl3-behind-a-gobject-shim.md).
//
// WHY A SEAM. The manager used to BE the libmanette binding: Manette signals, kernel
// `BTN_*` codes and hat axes were handled inline next to the slot bookkeeping. A second
// backend (darwin: SDL3 behind a GObject shim) speaks a different vocabulary entirely —
// SDL gamepad buttons, not evdev codes — so it would have meant a second copy of the
// slot, snapshot and event logic. The split puts every platform vocabulary INSIDE its
// source and leaves ONE copy of what the spec defines.
//
// WHY THE SINK SPEAKS W3C. Mapping to the standard layout is per backend (evdev codes for
// Manette, SDL's layout for the shim) and belongs where the vocabulary is known. What
// crosses this seam is already `buttons[i]` / `axes[i]` of the standard mapping, so the
// manager has nothing platform-specific left to decide.
//
// It also makes the manager testable without hardware or a typelib: a source is a plain
// object, and the manager takes one directly (`new GamepadManager({ source })`).

import type { GamepadHapticActuator } from './gamepad.js';

/**
 * One physical device, as a source reports it. The OBJECT is the identity: the manager
 * keys its slot on it, so a source must hand the same object to every call about the
 * same device.
 */
export interface GamepadSourceDevice {
    /** Becomes `Gamepad.id`. */
    readonly id: string;
    /** Becomes `Gamepad.vibrationActuator`; `null` when the source cannot drive one. */
    readonly vibrationActuator: GamepadHapticActuator | null;
}

/**
 * Where a source reports to, in the W3C STANDARD mapping's vocabulary
 * (https://w3c.github.io/gamepad/#remapping): `index` is a standard button or axis
 * index, not a platform code. Calls about a device that is not connected, or with an
 * index outside the standard layout, are ignored — a source may forward what it does not
 * recognise without a guard of its own.
 */
export interface GamepadSourceSink {
    /** A device became available — selects an index for it and fires `gamepadconnected`. */
    connected(device: GamepadSourceDevice): void;
    /** The device went away — frees its index and fires `gamepaddisconnected`. */
    disconnected(device: GamepadSourceDevice): void;
    /**
     * A button's state. `value` is 0..1; `pressed` is passed explicitly because only the
     * source knows whether the control is digital (pressed ⇔ value 1) or analog, where
     * the threshold is its call.
     */
    button(device: GamepadSourceDevice, index: number, value: number, pressed: boolean): void;
    /** A stick axis, -1..1. Analog triggers are BUTTONS 6/7 in the standard layout. */
    axis(device: GamepadSourceDevice, index: number, value: number): void;
}

/** A platform's gamepad subsystem, behind the one contract the manager drives. */
export interface GamepadSource {
    /** Names the backend in diagnostics, e.g. `gi://Manette`. */
    readonly name: string;
    /**
     * One sentence on what this backend needs to start, appended to the report when
     * {@link start} throws. That report must not guess: udev advice for a darwin backend
     * would be wrong advice.
     */
    readonly startRequirements?: string;
    /**
     * Begin reporting to `sink`. Devices that are already present are reported as
     * `connected` too. May throw — the manager reports that as a monitor fault, distinct
     * from a backend that failed to load. Called again after {@link stop} when a disposed
     * manager is used again.
     */
    start(sink: GamepadSourceSink): void;
    /**
     * Refresh device state. A PULL backend (SDL is polled) implements it; the manager
     * calls it at the top of every `getGamepads()`, which is exactly the W3C polling
     * moment. A PUSH backend (Manette emits signals) omits it.
     */
    poll?(): void;
    /** Stop reporting and release every native handle. Must be safe after a failed start. */
    stop(): void;
}
