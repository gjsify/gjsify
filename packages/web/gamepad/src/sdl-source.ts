// The SDL3 device source — `gi://GjsifyGamepad`, the shim in `@gjsify/gamepad-native`
// (ADR 0075 + Amendment 1). darwin and win32 use it; Linux uses it with
// `GJSIFY_GAMEPAD_BACKEND=sdl`, or next to `ManetteSource` with `=compare`, until it is
// proven there on real controllers.
//
// The shim already speaks the W3C standard layout — its snapshot is 17 button values and
// 4 axis values in W3C order — so the SDL → W3C table lives once, in C, for every OS and
// every JS host. What is left here is the GObject plumbing and the one decision the shim
// leaves to the source: when an analog value counts as `pressed`.

import { TRIGGER_PRESS_THRESHOLD, W3C_AXIS_COUNT } from './axis-mapping.js';
import { W3C_BUTTON_COUNT, W3CButton } from './button-mapping.js';
import { SdlHapticActuator } from './haptic-actuator.js';
import type { GjsifyGamepadDevice, GjsifyGamepadMonitor, GjsifyGamepadNamespace } from './sdl-namespace.js';
import type { GamepadSource, GamepadSourceDevice, GamepadSourceSink } from './source.js';

interface Tracked {
    handle: GamepadSourceDevice;
    /** What the sink last heard, so a poll forwards only what changed. */
    buttons: number[];
    axes: number[];
}

/** Whether a standard-layout button value counts as pressed. */
function isPressed(index: number, value: number): boolean {
    // Only the triggers are analog in the shim's snapshot; every other button is
    // exactly 0 or 1, so for those "pressed" is simply "not 0".
    return index === W3CButton.LEFT_TRIGGER || index === W3CButton.RIGHT_TRIGGER
        ? value > TRIGGER_PRESS_THRESHOLD
        : value > 0;
}

/**
 * `GjsifyGamepad.Monitor` as a {@link GamepadSource}. Pull model: `poll()` pumps SDL and
 * forwards the changed values, at exactly the W3C polling moment. Hotplug is also pushed
 * between polls, by the monitor's own GLib timeout, so `gamepadconnected` reaches a page
 * that has not polled yet.
 */
export class SdlSource implements GamepadSource {
    readonly name = 'gi://GjsifyGamepad';
    readonly startRequirements =
        "SDL's gamepad subsystem has to start in this process; the error carries SDL's own reason.";

    private _monitor: GjsifyGamepadMonitor | null = null;
    private _sink: GamepadSourceSink | null = null;
    private _signalIds: number[] = [];
    private readonly _devices = new Map<GjsifyGamepadDevice, Tracked>();

    constructor(private readonly _GjsifyGamepad: GjsifyGamepadNamespace) {}

    start(sink: GamepadSourceSink): void {
        // Throws a GLib.Error when SDL does not start; the manager reports that as a
        // monitor fault, distinct from a backend that failed to load.
        const monitor = this._GjsifyGamepad.Monitor.new();
        this._monitor = monitor;
        this._sink = sink;
        this._signalIds.push(
            monitor.connect('device-added', (_monitor, device) => this._add(device, sink)),
            monitor.connect('device-removed', (_monitor, device) => this._remove(device, sink)),
        );
        // The shim reports controllers that are ALREADY connected on its first update,
        // and the source contract wants them reported by start().
        monitor.update();
    }

    poll(): void {
        const monitor = this._monitor;
        const sink = this._sink;
        if (!monitor || !sink) return;
        monitor.update();
        // A device this very update removed is out of the map already.
        for (const [device, tracked] of this._devices) this._report(device, tracked, sink);
    }

    stop(): void {
        const monitor = this._monitor;
        this._monitor = null;
        this._sink = null;
        if (monitor) {
            for (const id of this._signalIds) monitor.disconnect(id);
            // Releases SDL now, not whenever the garbage collector reaches the wrapper.
            monitor.close();
        }
        this._signalIds = [];
        this._devices.clear();
    }

    private _add(device: GjsifyGamepadDevice, sink: GamepadSourceSink): void {
        if (this._devices.has(device)) return;
        const handle: GamepadSourceDevice = {
            id: device.get_name(),
            vibrationActuator: new SdlHapticActuator(device),
        };
        const tracked: Tracked = {
            handle,
            buttons: Array.from<number>({ length: W3C_BUTTON_COUNT }).fill(0),
            axes: Array.from<number>({ length: W3C_AXIS_COUNT }).fill(0),
        };
        this._devices.set(device, tracked);
        sink.connected(handle);
        // A slot starts at rest; forward whatever is already held down.
        this._report(device, tracked, sink);
    }

    private _remove(device: GjsifyGamepadDevice, sink: GamepadSourceSink): void {
        const tracked = this._devices.get(device);
        if (!tracked) return;
        this._devices.delete(device);
        sink.disconnected(tracked.handle);
    }

    /**
     * Forward the values that changed since the sink last heard. Unchanged values are
     * not re-sent because every sink call stamps `Gamepad.timestamp`, which the W3C
     * spec advances only when the device reported new data.
     */
    private _report(device: GjsifyGamepadDevice, tracked: Tracked, sink: GamepadSourceSink): void {
        const buttons = device.get_buttons();
        for (let i = 0; i < W3C_BUTTON_COUNT; i++) {
            const value = buttons[i] ?? 0;
            if (value === tracked.buttons[i]) continue;
            tracked.buttons[i] = value;
            sink.button(tracked.handle, i, value, isPressed(i, value));
        }
        const axes = device.get_axes();
        for (let i = 0; i < W3C_AXIS_COUNT; i++) {
            const value = axes[i] ?? 0;
            if (value === tracked.axes[i]) continue;
            tracked.axes[i] = value;
            sink.axis(tracked.handle, i, value);
        }
    }
}
