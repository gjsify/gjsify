// Two backends on the same controllers — ADR 0075 Amendment 1, point 4.
//
// On Linux the SDL3 shim replaces libmanette only after the two have been compared on
// real controllers. That comparison needs both running in ONE process against the SAME
// devices, with the page still driven exactly as it is today; this source is that
// arrangement. The primary (libmanette) reports to the manager untouched. The shadow
// (SDL) reports into a private copy of the W3C state that nothing else reads, and at
// every poll the two copies are compared and the differences are reported.
//
// Enabled with `GJSIFY_GAMEPAD_BACKEND=compare` (`backend.ts`); nothing else constructs it.

import { W3C_AXIS_COUNT } from './axis-mapping.js';
import { W3C_BUTTON_COUNT } from './button-mapping.js';
import type { GamepadSource, GamepadSourceDevice, GamepadSourceSink } from './source.js';

/**
 * Below this, two values are the same reading. The backends scale differently on
 * purpose: libmanette hands the manager the kernel's value normalised by the evdev
 * range, SDL rescales to int16 first, so a centred stick can differ in the fourth
 * decimal. A real disagreement (a wrong mapping, an inverted axis, a missing
 * button) is a difference of 0.5 or more.
 */
const TOLERANCE = 0.02;

interface Mirror {
    device: GamepadSourceDevice;
    buttons: number[];
    pressed: boolean[];
    axes: number[];
}

/** Where a comparison is written. `console.warn` unless a test captures it. */
export type CompareReport = (line: string) => void;

/** One backend's view: its connected devices, in connection order. */
class MirrorSink implements GamepadSourceSink {
    readonly devices = new Map<GamepadSourceDevice, Mirror>();

    constructor(
        private readonly _label: string,
        private readonly _report: CompareReport,
        private readonly _forward: GamepadSourceSink | null,
    ) {}

    connected(device: GamepadSourceDevice): void {
        if (!this.devices.has(device)) {
            this.devices.set(device, {
                device,
                buttons: Array.from<number>({ length: W3C_BUTTON_COUNT }).fill(0),
                pressed: Array.from<boolean>({ length: W3C_BUTTON_COUNT }).fill(false),
                axes: Array.from<number>({ length: W3C_AXIS_COUNT }).fill(0),
            });
            this._report(`${this._label}: connected "${device.id}"`);
        }
        this._forward?.connected(device);
    }

    disconnected(device: GamepadSourceDevice): void {
        if (this.devices.delete(device)) this._report(`${this._label}: disconnected "${device.id}"`);
        this._forward?.disconnected(device);
    }

    button(device: GamepadSourceDevice, index: number, value: number, pressed: boolean): void {
        const mirror = this.devices.get(device);
        if (mirror && index >= 0 && index < W3C_BUTTON_COUNT) {
            mirror.buttons[index] = value;
            mirror.pressed[index] = pressed;
        }
        this._forward?.button(device, index, value, pressed);
    }

    axis(device: GamepadSourceDevice, index: number, value: number): void {
        const mirror = this.devices.get(device);
        if (mirror && index >= 0 && index < W3C_AXIS_COUNT) mirror.axes[index] = value;
        this._forward?.axis(device, index, value);
    }
}

/** Every control on which two readings of one controller disagree. */
function differences(primary: Mirror, shadow: Mirror): string[] {
    const found: string[] = [];
    for (let i = 0; i < W3C_BUTTON_COUNT; i++) {
        const a = primary.buttons[i];
        const b = shadow.buttons[i];
        if (Math.abs(a - b) > TOLERANCE || primary.pressed[i] !== shadow.pressed[i]) {
            found.push(
                `button ${i}: ${a.toFixed(2)}${primary.pressed[i] ? '*' : ''} vs ${b.toFixed(2)}${shadow.pressed[i] ? '*' : ''}`,
            );
        }
    }
    for (let i = 0; i < W3C_AXIS_COUNT; i++) {
        const a = primary.axes[i];
        const b = shadow.axes[i];
        if (Math.abs(a - b) > TOLERANCE) found.push(`axis ${i}: ${a.toFixed(2)} vs ${b.toFixed(2)}`);
    }
    return found;
}

/**
 * The primary drives the page; the shadow is compared against it.
 *
 * Devices are paired by connection ORDER — the n-th controller each backend still
 * has. Neither backend can name the other's device (Manette's is an evdev node, SDL's
 * a joystick instance id), and a pair connected one after the other is paired
 * correctly by order in both. A count mismatch is itself reported.
 *
 * A difference is reported when it has held for two consecutive polls, and again
 * only when the set of differences changes. Manette pushes from the main loop while
 * SDL is pulled at the poll, so for one frame after a change the two legitimately
 * disagree; a comparison that reported that would bury the real findings.
 */
export class ComparingSource implements GamepadSource {
    readonly name: string;
    readonly startRequirements?: string;

    private _primarySink: MirrorSink | null = null;
    private _shadowSink: MirrorSink | null = null;
    private _shadowStarted = false;
    private _pending = '';
    private _reported = '';

    constructor(
        private readonly _primary: GamepadSource,
        private readonly _shadow: GamepadSource,
        private readonly _report: CompareReport = (line) => console.warn(`[@gjsify/gamepad compare] ${line}`),
    ) {
        this.name = `${_primary.name} (compared against ${_shadow.name})`;
        this.startRequirements = _primary.startRequirements;
    }

    start(sink: GamepadSourceSink): void {
        this._primarySink = new MirrorSink(this._primary.name, this._report, sink);
        this._shadowSink = new MirrorSink(this._shadow.name, this._report, null);
        // The primary first, and its failure is the manager's to report: the page
        // depends on it. The shadow's failure must not take the page down with it —
        // the comparison is a measurement riding along — so it is reported here and
        // the primary keeps running alone.
        this._primary.start(this._primarySink);
        try {
            this._shadow.start(this._shadowSink);
            this._shadowStarted = true;
            this._report(`comparing ${this._primary.name} against ${this._shadow.name}`);
        } catch (error) {
            this._report(`${this._shadow.name} did not start, nothing to compare against: ${String(error)}`);
            this._shadow.stop();
        }
    }

    poll(): void {
        this._primary.poll?.();
        if (!this._shadowStarted) return;
        this._shadow.poll?.();
        this._compare();
    }

    stop(): void {
        this._primary.stop();
        if (this._shadowStarted) this._shadow.stop();
        this._shadowStarted = false;
        this._primarySink = null;
        this._shadowSink = null;
        this._pending = '';
        this._reported = '';
    }

    private _compare(): void {
        const primary = [...(this._primarySink?.devices.values() ?? [])];
        const shadow = [...(this._shadowSink?.devices.values() ?? [])];
        const lines: string[] = [];
        if (primary.length !== shadow.length) {
            lines.push(
                `${this._primary.name} sees ${primary.length} controller(s), ${this._shadow.name} sees ${shadow.length}`,
            );
        }
        for (let i = 0; i < Math.min(primary.length, shadow.length); i++) {
            const found = differences(primary[i], shadow[i]);
            if (found.length > 0) {
                lines.push(`"${primary[i].device.id}" vs "${shadow[i].device.id}": ${found.join(', ')}`);
            }
        }
        const key = lines.join('\n');
        const settled = key === this._pending;
        this._pending = key;
        if (!settled || key === this._reported) return;
        this._reported = key;
        if (key === '') {
            this._report('the two backends agree again');
        } else {
            for (const line of lines) this._report(line);
        }
    }
}
