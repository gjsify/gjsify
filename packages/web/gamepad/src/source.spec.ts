// Coverage for the device-source seam (ADR 0075) — the W3C state the manager keeps, driven
// by a FAKE source, and the Manette adapter driven by a FAKE Manette namespace.
//
// Nothing here needs a controller, a typelib or a platform: that is the point of the
// seam. No CI runner has a gamepad attached, so before it existed the manager's state
// handling (index selection, button/axis values, the events) had no test at all, and a
// new backend would have had nothing to be checked against.
//
// Host globals are read through a typed VIEW (`host.dispatchEvent`), not as
// `globalThis.X`: `--globals auto` reads the latter as a free global and injects a
// register set into the test bundle — see the header of `register.spec.ts`.

import type Manette from '@girs/manette-0.2';
import { describe, expect, it } from '@gjsify/unit';

import { _resetGamepadBackendCache, loadGamepadBackend } from './backend.js';
import { LinuxButton, W3CButton } from './button-mapping.js';
import { ManetteAxis, W3CAxis } from './axis-mapping.js';
import { GamepadManager } from './gamepad-manager.js';
import type { GamepadEvent } from './gamepad-event.js';
import { ManetteSource } from './manette-source.js';
import { modelFromGuid, type GamepadSource, type GamepadSourceDevice, type GamepadSourceSink } from './source.js';

/** A device as a source reports it. */
function fakeDevice(id: string): GamepadSourceDevice {
    return { id, vibrationActuator: null };
}

/**
 * A scriptable source: `present` devices are reported by `start()`, `plug`/`unplug` and
 * the sink drive the rest, and `onPoll` makes it a PULL backend.
 */
class FakeSource implements GamepadSource {
    readonly name = 'fake://gamepad';
    readonly startRequirements = 'The fake needs nothing.';
    sink: GamepadSourceSink | null = null;
    starts = 0;
    stops = 0;
    polls = 0;
    onPoll: ((sink: GamepadSourceSink) => void) | null = null;
    failStart: Error | null = null;

    constructor(readonly present: GamepadSourceDevice[] = []) {}

    start(sink: GamepadSourceSink): void {
        this.starts++;
        this.sink = sink;
        for (const device of this.present) sink.connected(device);
        if (this.failStart) throw this.failStart;
    }

    poll(): void {
        this.polls++;
        if (this.sink && this.onPoll) this.onPoll(this.sink);
    }

    stop(): void {
        this.stops++;
        this.sink = null;
    }
}

interface HostGlobals {
    dispatchEvent?: (event: unknown) => boolean;
}
const host = globalThis as unknown as HostGlobals;

/** Run `body` with the host's `dispatchEvent` captured. */
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

async function capturingConsole(body: () => Promise<void>): Promise<{ warnings: string[]; errors: string[] }> {
    const captured = { warnings: [] as string[], errors: [] as string[] };
    const origWarn = console.warn;
    const origError = console.error;
    console.warn = (...args: unknown[]) => captured.warnings.push(args.map(String).join(' '));
    console.error = (...args: unknown[]) => captured.errors.push(args.map(String).join(' '));
    try {
        await body();
    } finally {
        console.warn = origWarn;
        console.error = origError;
    }
    return captured;
}

async function flushMicrotasks(turns = 8): Promise<void> {
    for (let i = 0; i < turns; i++) await Promise.resolve();
}

/** A Manette device whose signals the test fires by hand. */
class FakeManetteDevice {
    private readonly handlers = new Map<number, [string, (...args: unknown[]) => void]>();
    private nextId = 1;
    rumbles: number[][] = [];

    constructor(private readonly name: string | null) {}

    get_name() {
        return this.name;
    }
    get_guid() {
        return 'guid-0';
    }
    has_rumble() {
        return true;
    }
    rumble(strong: number, weak: number, ms: number) {
        this.rumbles.push([strong, weak, ms]);
        return true;
    }
    connect(signal: string, handler: (...args: unknown[]) => void) {
        const id = this.nextId++;
        this.handlers.set(id, [signal, handler]);
        return id;
    }
    disconnect(id: number) {
        this.handlers.delete(id);
    }
    get connectedHandlers() {
        return this.handlers.size;
    }
    emit(signal: string, event?: unknown) {
        for (const [name, handler] of this.handlers.values()) {
            if (name === signal) handler(this, event);
        }
    }
}

const buttonEvent = (code: number) => ({ get_button: () => [true, code] });
const axisEvent = (axis: number, value: number) => ({ get_absolute: () => [true, axis, value] });
const hatEvent = (axis: number, value: number) => ({ get_hat: () => [true, axis, value] });

/** A Manette namespace whose monitor reports `devices` and exposes its signals. */
function fakeManette(devices: FakeManetteDevice[]) {
    const monitorHandlers = new Map<number, [string, (...args: unknown[]) => void]>();
    class Monitor {
        iterate() {
            let i = 0;
            return { next: () => (i < devices.length ? [true, devices[i++]] : [false, null]) };
        }
        connect(signal: string, handler: (...args: unknown[]) => void) {
            const id = monitorHandlers.size + 1;
            monitorHandlers.set(id, [signal, handler]);
            return id;
        }
        disconnect(id: number) {
            monitorHandlers.delete(id);
        }
    }
    const emitMonitor = (signal: string, device: FakeManetteDevice) => {
        for (const [name, handler] of monitorHandlers.values()) {
            if (name === signal) handler(null, device);
        }
    };
    return { module: { Monitor } as unknown as typeof Manette, emitMonitor, monitorHandlers };
}

export default async () => {
    await describe('GamepadManager over a device source', async () => {
        await it('reports devices present at start on the FIRST getGamepads()', async () => {
            const source = new FakeSource([fakeDevice('Pad A')]);
            const manager = new GamepadManager({ source });
            const pads = manager.getGamepads();
            expect(pads).toHaveLength(1);
            expect(pads[0]?.id).toBe('Pad A');
            expect(pads[0]?.index).toBe(0);
            expect(pads[0]?.connected).toBe(true);
            expect(pads[0]?.mapping).toBe('standard');
            expect(pads[0]?.buttons).toHaveLength(17);
            expect(pads[0]?.axes).toStrictEqual([0, 0, 0, 0]);
            manager.dispose();
        });

        await it('does not consult the host probe when a source is injected', async () => {
            _resetGamepadBackendCache();
            const captured = await capturingConsole(async () => {
                // Prime the shared probe as a darwin host with no backend: an injected
                // source must win over it, and the probe's warning must not fire.
                await loadGamepadBackend({ hostOs: () => 'darwin' });
                const manager = new GamepadManager({ source: new FakeSource([fakeDevice('Pad')]) });
                expect(manager.getGamepads()).toHaveLength(1);
                await flushMicrotasks();
                manager.dispose();
            });
            expect(captured.warnings).toStrictEqual([]);
            expect(captured.errors).toStrictEqual([]);
            _resetGamepadBackendCache();
        });

        await it('selects the first free index and appends otherwise', async () => {
            const source = new FakeSource();
            const manager = new GamepadManager({ source });
            manager.getGamepads();
            const a = fakeDevice('A');
            const b = fakeDevice('B');
            const c = fakeDevice('C');
            source.sink!.connected(a);
            source.sink!.connected(b);
            // A duplicate report must not take a second index.
            source.sink!.connected(a);
            expect(manager.getGamepads().map((pad) => pad?.id)).toStrictEqual(['A', 'B']);
            source.sink!.disconnected(a);
            // The index is freed, not compacted: B keeps index 1.
            const afterUnplug = manager.getGamepads();
            expect(afterUnplug).toHaveLength(2);
            expect(afterUnplug[0]).toBeNull();
            expect(afterUnplug[1]?.index).toBe(1);
            source.sink!.connected(c);
            expect(manager.getGamepads()[0]?.id).toBe('C');
            manager.dispose();
        });

        await it('keeps button and axis state in the standard layout', async () => {
            const source = new FakeSource();
            const pad = fakeDevice('Pad');
            source.present.push(pad);
            const manager = new GamepadManager({ source });
            const before = manager.getGamepads()[0]!.timestamp;
            const sink = source.sink!;
            sink.button(pad, W3CButton.FACE_1, 1, true);
            // An analog trigger below its threshold: touched, not pressed.
            sink.button(pad, W3CButton.LEFT_TRIGGER, 0.25, false);
            sink.axis(pad, W3CAxis.LEFT_STICK_Y, -0.5);
            const snap = manager.getGamepads()[0]!;
            expect(snap.buttons[W3CButton.FACE_1].pressed).toBe(true);
            expect(snap.buttons[W3CButton.FACE_1].value).toBe(1);
            expect(snap.buttons[W3CButton.LEFT_TRIGGER].pressed).toBe(false);
            expect(snap.buttons[W3CButton.LEFT_TRIGGER].touched).toBe(true);
            expect(snap.buttons[W3CButton.LEFT_TRIGGER].value).toBe(0.25);
            expect(snap.axes[W3CAxis.LEFT_STICK_Y]).toBe(-0.5);
            expect(snap.timestamp >= before).toBe(true);
            // Snapshots are snapshots: a later change does not reach an old one.
            sink.button(pad, W3CButton.FACE_1, 0, false);
            expect(snap.buttons[W3CButton.FACE_1].pressed).toBe(true);
            expect(manager.getGamepads()[0]!.buttons[W3CButton.FACE_1].pressed).toBe(false);
            manager.dispose();
        });

        await it('ignores indices outside the standard layout and unknown devices', async () => {
            const source = new FakeSource();
            const pad = fakeDevice('Pad');
            source.present.push(pad);
            const manager = new GamepadManager({ source });
            manager.getGamepads();
            const sink = source.sink!;
            sink.button(pad, 17, 1, true);
            sink.button(pad, -1, 1, true);
            sink.axis(pad, 4, 1);
            sink.button(fakeDevice('never connected'), 0, 1, true);
            const snap = manager.getGamepads()[0]!;
            expect(snap.buttons).toHaveLength(17);
            expect(snap.buttons.every((button) => !button.pressed)).toBe(true);
            expect(snap.axes).toStrictEqual([0, 0, 0, 0]);
            manager.dispose();
        });

        await it('fires gamepadconnected and gamepaddisconnected with snapshots', async () => {
            const source = new FakeSource();
            const pad = fakeDevice('Pad');
            const manager = new GamepadManager({ source });
            const events = await capturingEvents(() => {
                manager.getGamepads();
                source.sink!.connected(pad);
                source.sink!.disconnected(pad);
                // A second disconnect of the same device is not a second event.
                source.sink!.disconnected(pad);
            });
            expect(events.map((event) => event.type)).toStrictEqual(['gamepadconnected', 'gamepaddisconnected']);
            expect(events[0].gamepad.connected).toBe(true);
            expect(events[1].gamepad.connected).toBe(false);
            expect(events[1].gamepad.index).toBe(0);
            manager.dispose();
        });

        await it('polls a PULL source at every getGamepads(), before the snapshot', async () => {
            const source = new FakeSource();
            const pad = fakeDevice('Pad');
            source.present.push(pad);
            let pollValue = 0;
            source.onPoll = (sink) => sink.axis(pad, W3CAxis.RIGHT_STICK_X, (pollValue += 0.25));
            const manager = new GamepadManager({ source });
            expect(manager.getGamepads()[0]!.axes[W3CAxis.RIGHT_STICK_X]).toBe(0.25);
            expect(manager.getGamepads()[0]!.axes[W3CAxis.RIGHT_STICK_X]).toBe(0.5);
            expect(source.polls).toBe(2);
            manager.dispose();
        });

        await it('stops the source on dispose and starts it again on reuse', async () => {
            const source = new FakeSource([fakeDevice('Pad')]);
            const manager = new GamepadManager({ source });
            manager.getGamepads();
            manager.dispose();
            expect(source.stops).toBe(1);
            expect(source.sink).toBeNull();
            const pads = manager.getGamepads();
            expect(source.starts).toBe(2);
            expect(pads).toHaveLength(1);
            expect(pads[0]?.index).toBe(0);
            manager.dispose();
        });

        await it('reports a source that fails to start with ITS requirements, and never polls it', async () => {
            const source = new FakeSource();
            source.failStart = new Error('device table unreadable');
            const manager = new GamepadManager({ source });
            const captured = await capturingConsole(async () => {
                expect(manager.getGamepads()).toStrictEqual([]);
                await flushMicrotasks();
                manager.getGamepads();
            });
            expect(captured.errors).toHaveLength(1);
            expect(captured.errors[0]).toContain('fake://gamepad');
            expect(captured.errors[0]).toContain('The fake needs nothing.');
            expect(captured.errors[0]).toContain('device table unreadable');
            // The requirements are the SOURCE's: no udev advice for a non-Manette backend.
            expect(captured.errors[0]).not.toContain('udev');
            expect(source.polls).toBe(0);
            // A half-started source still holds whatever it acquired: release it.
            manager.dispose();
            expect(source.stops).toBe(1);
        });
    });

    await describe('modelFromGuid', async () => {
        await it('reads vendor:product from the GUIDs both backends reported for one pad', async () => {
            // Measured: an 8BitDo N30 Pro 2 over Bluetooth, libmanette vs SDL3 (CRC differs).
            expect(modelFromGuid('05000000c82d00006528000000010000')).toBe('2dc8:2865');
            expect(modelFromGuid('05004c0cc82d00006528000000010000')).toBe('2dc8:2865');
            expect(modelFromGuid('030081b85e0400008e02000014010000')).toBe('045e:028e');
            expect(modelFromGuid('05000000000000000000000000000000')).toBeUndefined();
            expect(modelFromGuid(null)).toBeUndefined();
        });
    });

    await describe('ManetteSource', async () => {
        await it('reads the right stick from ABS_RX/ABS_RY, the codes libmanette actually emits', async () => {
            // Literal evdev codes, NOT the ManetteAxis constants: a mapped libmanette
            // device reports `rightx`/`righty` as ABS_RX (3) / ABS_RY (4) — its mapping
            // table (manette-mapping.c) and a uinput pad measured through
            // gi://Manette agree. The constants once said 2/3, so the right stick's X
            // landed on W3C axis 3 and its Y on the left trigger, and a test written
            // against the constants could not see it (an 8BitDo N30 Pro 2 did).
            const device = new FakeManetteDevice('Manette Pad');
            const { module } = fakeManette([device]);
            const manager = new GamepadManager({ source: new ManetteSource(module) });
            expect(manager.getGamepads()[0]?.id).toBe('Manette Pad');
            device.emit('absolute-axis-event', axisEvent(3 /* ABS_RX */, 0.5));
            device.emit('absolute-axis-event', axisEvent(4 /* ABS_RY */, -0.25));
            device.emit('absolute-axis-event', axisEvent(1 /* ABS_Y */, 0.125));
            const snap = manager.getGamepads()[0]!;
            expect(snap.axes[W3CAxis.RIGHT_STICK_X]).toBe(0.5);
            expect(snap.axes[W3CAxis.RIGHT_STICK_Y]).toBe(-0.25);
            expect(snap.axes[W3CAxis.LEFT_STICK_Y]).toBe(0.125);
            expect(snap.buttons[W3CButton.LEFT_TRIGGER].value).toBe(0);
            expect(snap.buttons[W3CButton.RIGHT_TRIGGER].value).toBe(0);
            manager.dispose();
        });

        await it('maps libmanette buttons, hats, sticks and triggers to the standard layout', async () => {
            const device = new FakeManetteDevice('Manette Pad');
            const { module } = fakeManette([device]);
            const manager = new GamepadManager({ source: new ManetteSource(module) });
            expect(manager.getGamepads()[0]?.id).toBe('Manette Pad');

            device.emit('button-press-event', buttonEvent(LinuxButton.BTN_SOUTH));
            device.emit('button-press-event', buttonEvent(LinuxButton.BTN_MODE));
            device.emit('hat-axis-event', hatEvent(0, -1));
            device.emit('hat-axis-event', hatEvent(1, 1));
            device.emit('absolute-axis-event', axisEvent(ManetteAxis.LEFT_X, 0.75));
            // libmanette reports triggers on the -1..1 axis scale: 0.5 → 0.75.
            device.emit('absolute-axis-event', axisEvent(ManetteAxis.RIGHT_TRIGGER, 0.5));
            device.emit('absolute-axis-event', axisEvent(ManetteAxis.LEFT_TRIGGER, -0.5));
            // A code outside the mapping is dropped, not written somewhere.
            device.emit('button-press-event', buttonEvent(LinuxButton.BTN_C));

            let snap = manager.getGamepads()[0]!;
            expect(snap.buttons[W3CButton.FACE_1].pressed).toBe(true);
            expect(snap.buttons[W3CButton.HOME].pressed).toBe(true);
            expect(snap.buttons[W3CButton.DPAD_LEFT].pressed).toBe(true);
            expect(snap.buttons[W3CButton.DPAD_RIGHT].pressed).toBe(false);
            expect(snap.buttons[W3CButton.DPAD_DOWN].pressed).toBe(true);
            expect(snap.buttons[W3CButton.DPAD_UP].pressed).toBe(false);
            expect(snap.axes[W3CAxis.LEFT_STICK_X]).toBe(0.75);
            expect(snap.buttons[W3CButton.RIGHT_TRIGGER].value).toBe(0.75);
            expect(snap.buttons[W3CButton.RIGHT_TRIGGER].pressed).toBe(true);
            expect(snap.buttons[W3CButton.LEFT_TRIGGER].value).toBe(0.25);
            expect(snap.buttons[W3CButton.LEFT_TRIGGER].pressed).toBe(false);
            expect(snap.buttons.filter((button) => button.pressed)).toHaveLength(5);

            device.emit('button-release-event', buttonEvent(LinuxButton.BTN_SOUTH));
            device.emit('hat-axis-event', hatEvent(0, 0));
            snap = manager.getGamepads()[0]!;
            expect(snap.buttons[W3CButton.FACE_1].pressed).toBe(false);
            expect(snap.buttons[W3CButton.DPAD_LEFT].pressed).toBe(false);
            manager.dispose();
        });

        await it('follows hotplug and releases every signal on disconnect and dispose', async () => {
            const first = new FakeManetteDevice('First');
            const second = new FakeManetteDevice(null);
            const { module, emitMonitor, monitorHandlers } = fakeManette([first]);
            const manager = new GamepadManager({ source: new ManetteSource(module) });
            manager.getGamepads();
            expect(monitorHandlers.size).toBe(2);

            emitMonitor('device-connected', second);
            let pads = manager.getGamepads();
            // No name: the GUID stands in, as before the split.
            expect(pads[1]?.id).toBe('Gamepad (guid-0)');

            // The device's own `disconnected` signal is one of the two removal paths.
            first.emit('disconnected');
            expect(first.connectedHandlers).toBe(0);
            pads = manager.getGamepads();
            expect(pads[0]).toBeNull();
            expect(pads[1]?.id).toBe('Gamepad (guid-0)');

            manager.dispose();
            expect(second.connectedHandlers).toBe(0);
            expect(monitorHandlers.size).toBe(0);
        });

        await it('drives rumble through the Manette device', async () => {
            const device = new FakeManetteDevice('Rumble Pad');
            const { module } = fakeManette([device]);
            const manager = new GamepadManager({ source: new ManetteSource(module) });
            const actuator = manager.getGamepads()[0]!.vibrationActuator!;
            expect(actuator.effects).toStrictEqual(['dual-rumble']);
            expect(
                await actuator.playEffect('dual-rumble', { duration: 100, strongMagnitude: 1, weakMagnitude: 0 }),
            ).toBe('complete');
            expect(device.rumbles).toStrictEqual([[65535, 0, 100]]);
            // The shared W3C actuator: a reset stops the motors and preempts what plays.
            const pending = actuator.playEffect('dual-rumble', { duration: 4000, weakMagnitude: 0.5 });
            expect(await actuator.reset()).toBe('complete');
            expect(await pending).toBe('preempted');
            expect(device.rumbles).toStrictEqual([
                [65535, 0, 100],
                [0, 32768, 4000],
                [0, 0, 0],
            ]);
            manager.dispose();
        });
    });
};
