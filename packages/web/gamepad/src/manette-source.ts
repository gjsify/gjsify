// The libmanette 0.2 device source — Linux (ADR 0075 keeps it there: libmanette links
// libevdev unconditionally, so it exists nowhere else).
//
// Everything Manette-shaped lives here: the monitor and its signals, the kernel `BTN_*`
// codes libmanette 0.2 puts on the wire, the hat axes and the trigger axes. What leaves
// this file is the W3C standard mapping (see `source.ts`).

import type Manette from '@girs/manette-0.2';
import { MANETTE_TO_W3C_AXIS, ManetteAxis, TRIGGER_PRESS_THRESHOLD } from './axis-mapping.js';
import { MANETTE_TO_W3C_BUTTON, W3CButton } from './button-mapping.js';
import { ManetteHapticActuator } from './haptic-actuator.js';
import { modelFromGuid, type GamepadSource, type GamepadSourceDevice, type GamepadSourceSink } from './source.js';

interface Tracked {
    handle: GamepadSourceDevice;
    signalIds: number[];
}

/** `Manette.Monitor` as a {@link GamepadSource}. Push model: no `poll()`. */
export class ManetteSource implements GamepadSource {
    readonly name = 'gi://Manette';
    readonly startRequirements =
        'Manette.Monitor needs udev and /dev/input access, which a sandbox can withhold (flatpak: --device=input).';

    private _monitor: Manette.Monitor | null = null;
    private _monitorSignalIds: number[] = [];
    private readonly _devices = new Map<Manette.Device, Tracked>();

    constructor(private readonly _Manette: typeof Manette) {}

    start(sink: GamepadSourceSink): void {
        const monitor = new this._Manette.Monitor();
        this._monitor = monitor;

        const iter = monitor.iterate();
        let result = iter.next();
        while (result[0]) {
            const device = result[1];
            if (device) this._add(device, sink);
            result = iter.next();
        }

        this._monitorSignalIds.push(
            monitor.connect('device-connected', (_monitor: Manette.Monitor, device: Manette.Device) => {
                this._add(device, sink);
            }),
            monitor.connect('device-disconnected', (_monitor: Manette.Monitor, device: Manette.Device) => {
                this._remove(device, sink);
            }),
        );
    }

    stop(): void {
        for (const [device, tracked] of this._devices) {
            for (const id of tracked.signalIds) device.disconnect(id);
        }
        this._devices.clear();
        if (this._monitor) {
            for (const id of this._monitorSignalIds) this._monitor.disconnect(id);
            this._monitor = null;
        }
        this._monitorSignalIds = [];
    }

    private _add(device: Manette.Device, sink: GamepadSourceSink): void {
        if (this._devices.has(device)) return;
        const handle: GamepadSourceDevice = {
            id: device.get_name() ?? `Gamepad (${device.get_guid()})`,
            vibrationActuator: new ManetteHapticActuator(device),
            model: modelFromGuid(device.get_guid()),
        };
        const tracked: Tracked = { handle, signalIds: [] };
        this._devices.set(device, tracked);

        tracked.signalIds.push(
            device.connect('button-press-event', (_device: Manette.Device, event: Manette.Event) => {
                this._onButton(handle, event, true, sink);
            }),
            device.connect('button-release-event', (_device: Manette.Device, event: Manette.Event) => {
                this._onButton(handle, event, false, sink);
            }),
            device.connect('absolute-axis-event', (_device: Manette.Device, event: Manette.Event) => {
                this._onAxis(handle, event, sink);
            }),
            device.connect('hat-axis-event', (_device: Manette.Device, event: Manette.Event) => {
                this._onHat(handle, event, sink);
            }),
            device.connect('disconnected', () => {
                this._remove(device, sink);
            }),
        );

        sink.connected(handle);
    }

    private _remove(device: Manette.Device, sink: GamepadSourceSink): void {
        const tracked = this._devices.get(device);
        if (!tracked) return;
        for (const id of tracked.signalIds) device.disconnect(id);
        this._devices.delete(device);
        sink.disconnected(tracked.handle);
    }

    private _onButton(handle: GamepadSourceDevice, event: Manette.Event, down: boolean, sink: GamepadSourceSink): void {
        const [ok, button] = event.get_button();
        if (!ok) return;
        const index = MANETTE_TO_W3C_BUTTON.get(button);
        if (index === undefined) return;
        sink.button(handle, index, down ? 1 : 0, down);
    }

    private _onAxis(handle: GamepadSourceDevice, event: Manette.Event, sink: GamepadSourceSink): void {
        const [ok, axis, value] = event.get_absolute();
        if (!ok) return;

        const axisIndex = MANETTE_TO_W3C_AXIS.get(axis);
        if (axisIndex !== undefined) {
            sink.axis(handle, axisIndex, value);
            return;
        }
        // The standard layout has no trigger AXES: they are analog buttons 6/7, and
        // libmanette reports them on the -1..1 axis scale.
        const trigger =
            axis === ManetteAxis.LEFT_TRIGGER
                ? W3CButton.LEFT_TRIGGER
                : axis === ManetteAxis.RIGHT_TRIGGER
                  ? W3CButton.RIGHT_TRIGGER
                  : undefined;
        if (trigger === undefined) return;
        const normalized = (value + 1) / 2;
        sink.button(handle, trigger, normalized, normalized > TRIGGER_PRESS_THRESHOLD);
    }

    private _onHat(handle: GamepadSourceDevice, event: Manette.Event, sink: GamepadSourceSink): void {
        const [ok, hatAxis, hatValue] = event.get_hat();
        if (!ok) return;
        // Hat axis 0 is horizontal, 1 vertical; values -1/0/1. The standard layout
        // spells the d-pad as four buttons, so one hat event updates two of them.
        const [negative, positive] =
            hatAxis === 0
                ? [W3CButton.DPAD_LEFT, W3CButton.DPAD_RIGHT]
                : hatAxis === 1
                  ? [W3CButton.DPAD_UP, W3CButton.DPAD_DOWN]
                  : [undefined, undefined];
        if (negative === undefined || positive === undefined) return;
        sink.button(handle, negative, hatValue < 0 ? 1 : 0, hatValue < 0);
        sink.button(handle, positive, hatValue > 0 ? 1 : 0, hatValue > 0);
    }
}
