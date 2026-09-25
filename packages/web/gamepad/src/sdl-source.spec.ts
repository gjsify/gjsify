// Coverage for the SDL3 device source (ADR 0075) against a FAKE `gi://GjsifyGamepad`.
//
// The fake keeps the shim's contract, not its implementation: `update()` reconciles the
// connected set and emits `device-removed` before `device-added`, and a device's snapshot
// is already in the W3C standard layout. What the REAL shim does against SDL is tested in
// `@gjsify/gamepad-native` itself (meson test: C and gjs, with `leaks`); what these tests
// pin is everything this package adds on top — the plumbing, the diffing, the pressed
// rule, rumble and the lifecycle.
//
// Host globals are read through a typed VIEW, as in `source.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { W3CAxis } from './axis-mapping.js';
import { W3CButton } from './button-mapping.js';
import type { GamepadEvent } from './gamepad-event.js';
import { GamepadManager } from './gamepad-manager.js';
import type { GjsifyGamepadDevice, GjsifyGamepadMonitor, GjsifyGamepadNamespace } from './sdl-namespace.js';
import { SdlSource } from './sdl-source.js';

class FakeSdlDevice implements GjsifyGamepadDevice {
    buttons = Array.from<number>({ length: 17 }).fill(0);
    axes = Array.from<number>({ length: 4 }).fill(0);
    rumbles: number[][] = [];
    triggerRumbles: number[][] = [];

    constructor(
        private readonly name: string,
        private readonly capabilities: { rumble?: boolean; triggers?: boolean } = {},
    ) {}

    get_name() {
        return this.name;
    }
    get_buttons() {
        return [...this.buttons];
    }
    get_axes() {
        return [...this.axes];
    }
    has_rumble() {
        return this.capabilities.rumble ?? false;
    }
    has_trigger_rumble() {
        return this.capabilities.triggers ?? false;
    }
    rumble(low: number, high: number, ms: number) {
        this.rumbles.push([low, high, ms]);
        return true;
    }
    rumble_triggers(left: number, right: number, ms: number) {
        this.triggerRumbles.push([left, right, ms]);
        return true;
    }
}

type Handler = (monitor: GjsifyGamepadMonitor, device: GjsifyGamepadDevice) => void;

/**
 * A `gi://GjsifyGamepad` whose connected set the test edits (`connected`); every
 * monitor reconciles against it on `update()`, as the shim reconciles against SDL.
 */
function fakeGjsifyGamepad(connected: FakeSdlDevice[] = []) {
    const monitors: FakeMonitor[] = [];
    let failNew: Error | null = null;

    class FakeMonitor implements GjsifyGamepadMonitor {
        static new(): FakeMonitor {
            if (failNew) throw failNew;
            const monitor = new FakeMonitor();
            monitors.push(monitor);
            return monitor;
        }

        updates = 0;
        closed = false;
        reported: FakeSdlDevice[] = [];
        readonly handlers = new Map<number, [string, Handler]>();
        private nextId = 1;

        update() {
            if (this.closed) return;
            this.updates++;
            const gone = this.reported.filter((device) => !connected.includes(device));
            const fresh = connected.filter((device) => !this.reported.includes(device));
            this.reported = [...connected];
            for (const device of gone) this.emit('device-removed', device);
            for (const device of fresh) this.emit('device-added', device);
        }
        close() {
            this.closed = true;
        }
        connect(signal: string, handler: Handler) {
            const id = this.nextId++;
            this.handlers.set(id, [signal, handler]);
            return id;
        }
        disconnect(id: number) {
            this.handlers.delete(id);
        }
        private emit(signal: string, device: FakeSdlDevice) {
            for (const [name, handler] of this.handlers.values()) {
                if (name === signal) handler(this, device);
            }
        }
    }

    return {
        module: { Monitor: FakeMonitor } as GjsifyGamepadNamespace,
        monitors,
        failNextNew(error: Error) {
            failNew = error;
        },
    };
}

interface HostGlobals {
    dispatchEvent?: (event: unknown) => boolean;
}
const host = globalThis as unknown as HostGlobals;

async function capturingEvents(body: () => Promise<void> | void): Promise<GamepadEvent[]> {
    const events: GamepadEvent[] = [];
    const original = host.dispatchEvent;
    host.dispatchEvent = (event) => {
        events.push(event as GamepadEvent);
        return true;
    };
    try {
        await body();
    } finally {
        host.dispatchEvent = original;
    }
    return events;
}

async function capturingErrors(body: () => Promise<void>): Promise<string[]> {
    const errors: string[] = [];
    const original = console.error;
    console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
    try {
        await body();
    } finally {
        console.error = original;
    }
    return errors;
}

async function flushMicrotasks(turns = 8): Promise<void> {
    for (let i = 0; i < turns; i++) await Promise.resolve();
}

export default async () => {
    await describe('SdlSource', async () => {
        await it('reports controllers already connected on the first getGamepads()', async () => {
            const pad = new FakeSdlDevice('Xbox Series X Controller');
            const { module, monitors } = fakeGjsifyGamepad([pad]);
            const manager = new GamepadManager({ source: new SdlSource(module) });
            const pads = manager.getGamepads();
            expect(pads).toHaveLength(1);
            expect(pads[0]?.id).toBe('Xbox Series X Controller');
            expect(pads[0]?.mapping).toBe('standard');
            expect(monitors).toHaveLength(1);
            manager.dispose();
        });

        await it("passes the shim's standard-layout snapshot through, deciding only `pressed`", async () => {
            const pad = new FakeSdlDevice('Pad');
            const { module } = fakeGjsifyGamepad([pad]);
            const manager = new GamepadManager({ source: new SdlSource(module) });
            manager.getGamepads();

            pad.buttons[W3CButton.FACE_1] = 1;
            pad.buttons[W3CButton.HOME] = 1;
            pad.buttons[W3CButton.RIGHT_TRIGGER] = 0.75;
            pad.buttons[W3CButton.LEFT_TRIGGER] = 0.25;
            pad.axes[W3CAxis.LEFT_STICK_Y] = -1;
            pad.axes[W3CAxis.RIGHT_STICK_X] = 0.5;

            const snap = manager.getGamepads()[0]!;
            expect(snap.buttons[W3CButton.FACE_1].pressed).toBe(true);
            expect(snap.buttons[W3CButton.FACE_1].value).toBe(1);
            expect(snap.buttons[W3CButton.HOME].pressed).toBe(true);
            // Analog triggers: pressed above the shared threshold, touched whenever > 0.
            expect(snap.buttons[W3CButton.RIGHT_TRIGGER].value).toBe(0.75);
            expect(snap.buttons[W3CButton.RIGHT_TRIGGER].pressed).toBe(true);
            expect(snap.buttons[W3CButton.LEFT_TRIGGER].value).toBe(0.25);
            expect(snap.buttons[W3CButton.LEFT_TRIGGER].pressed).toBe(false);
            expect(snap.buttons[W3CButton.LEFT_TRIGGER].touched).toBe(true);
            expect(snap.axes).toStrictEqual([0, -1, 0.5, 0]);
            expect(snap.buttons.filter((button) => button.pressed)).toHaveLength(3);

            pad.buttons[W3CButton.FACE_1] = 0;
            expect(manager.getGamepads()[0]!.buttons[W3CButton.FACE_1].pressed).toBe(false);
            manager.dispose();
        });

        await it('pumps the shim at every getGamepads() and forwards only what changed', async () => {
            const pad = new FakeSdlDevice('Pad');
            const { module, monitors } = fakeGjsifyGamepad([pad]);
            const manager = new GamepadManager({ source: new SdlSource(module) });
            const first = manager.getGamepads()[0]!;
            const updates = monitors[0].updates;

            // Nothing changed: the state is re-read, and `timestamp` — which W3C advances
            // only when the device reported new data — stays where it was.
            const second = manager.getGamepads()[0]!;
            expect(monitors[0].updates).toBe(updates + 1);
            expect(second.timestamp).toBe(first.timestamp);

            pad.axes[W3CAxis.LEFT_STICK_X] = 0.25;
            // performance.now() may not have advanced within the same tick; the axis
            // value is the unambiguous half of "the change was forwarded".
            const third = manager.getGamepads()[0]!;
            expect(third.axes[W3CAxis.LEFT_STICK_X]).toBe(0.25);
            expect(third.timestamp >= second.timestamp).toBe(true);
            manager.dispose();
        });

        await it('follows hotplug from polls and from the monitor between polls', async () => {
            const first = new FakeSdlDevice('First');
            const second = new FakeSdlDevice('Second');
            const connected = [first];
            const { module, monitors } = fakeGjsifyGamepad(connected);
            const manager = new GamepadManager({ source: new SdlSource(module) });

            const events = await capturingEvents(() => {
                manager.getGamepads();
                // The shim's own GLib timeout runs update() between polls; a page that
                // has not polled still hears `gamepadconnected`.
                connected.push(second);
                monitors[0].update();
            });
            expect(events.map((event) => `${event.type}:${event.gamepad.id}`)).toStrictEqual([
                'gamepadconnected:First',
                'gamepadconnected:Second',
            ]);

            connected.splice(0, 1);
            const pads = manager.getGamepads();
            expect(pads[0]).toBeNull();
            expect(pads[1]?.id).toBe('Second');
            manager.dispose();
        });

        await it('closes the monitor and drops its signals on dispose, and starts a new one on reuse', async () => {
            const { module, monitors } = fakeGjsifyGamepad([new FakeSdlDevice('Pad')]);
            const manager = new GamepadManager({ source: new SdlSource(module) });
            manager.getGamepads();
            expect(monitors[0].handlers.size).toBe(2);

            manager.dispose();
            expect(monitors[0].closed).toBe(true);
            expect(monitors[0].handlers.size).toBe(0);
            expect(manager.getGamepads()).toHaveLength(1);
            expect(monitors).toHaveLength(2);
            expect(monitors[1].closed).toBe(false);
            manager.dispose();
        });

        await it('reports a monitor SDL could not start as a start fault naming SDL', async () => {
            const fake = fakeGjsifyGamepad();
            fake.failNextNew(new Error('SDL gamepad subsystem did not start: no HID manager'));
            const errors = await capturingErrors(async () => {
                const manager = new GamepadManager({ source: new SdlSource(fake.module) });
                expect(manager.getGamepads()).toStrictEqual([]);
                await flushMicrotasks();
                manager.dispose();
            });
            expect(errors).toHaveLength(1);
            expect(errors[0]).toContain('gi://GjsifyGamepad');
            expect(errors[0]).toContain('could not be started');
            expect(errors[0]).toContain("SDL's gamepad subsystem");
            expect(errors[0]).toContain('no HID manager');
        });

        await it('drives dual-rumble and trigger-rumble through the shim, and resets both', async () => {
            const pad = new FakeSdlDevice('Rumble Pad', { rumble: true, triggers: true });
            const { module } = fakeGjsifyGamepad([pad]);
            const manager = new GamepadManager({ source: new SdlSource(module) });
            const actuator = manager.getGamepads()[0]!.vibrationActuator!;
            expect(actuator.effects).toStrictEqual(['dual-rumble', 'trigger-rumble']);

            await actuator.playEffect('dual-rumble', { duration: 100, strongMagnitude: 1, weakMagnitude: 0 });
            await actuator.playEffect('trigger-rumble', { duration: 50, leftTrigger: 0.5, rightTrigger: 2 });
            await actuator.reset();
            expect(pad.rumbles).toStrictEqual([
                [65535, 0, 100],
                [0, 0, 0],
            ]);
            // 0.5 → half intensity; an out-of-range 2 is clamped, not wrapped past uint16.
            expect(pad.triggerRumbles).toStrictEqual([
                [32768, 65535, 50],
                [0, 0, 0],
            ]);
            manager.dispose();
        });

        await it('offers no effect a controller cannot play, and plays nothing for it', async () => {
            const pad = new FakeSdlDevice('Quiet Pad');
            const { module } = fakeGjsifyGamepad([pad]);
            const manager = new GamepadManager({ source: new SdlSource(module) });
            const actuator = manager.getGamepads()[0]!.vibrationActuator!;
            expect(actuator.effects).toStrictEqual([]);
            expect(await actuator.playEffect('dual-rumble', { duration: 100 })).toBe('complete');
            expect(pad.rumbles).toStrictEqual([]);
            manager.dispose();
        });
    });
};
