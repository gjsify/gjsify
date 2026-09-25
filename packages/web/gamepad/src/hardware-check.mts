// The Linux hardware check ADR 0075 Amendment 1 requires before libmanette is removed:
// libmanette and the SDL3 shim on the SAME real controller, side by side, through the
// real `ManetteSource` and `SdlSource`. Opt-in and never in CI — no runner has a
// controller, and the recording needs a person pressing buttons.
//
//   gjsify workspace @gjsify/gamepad run hardware-check            # 20 s recording
//   HARDWARE_CHECK_SECONDS=0 gjsify workspace @gjsify/gamepad run hardware-check   # enumerate only
//
// GI_TYPELIB_PATH / LD_LIBRARY_PATH must reach the shim (the `build/` directory of
// `@gjsify/gamepad-native`, or its prebuild). Prints one report: what each backend
// enumerates (name, GUID, the SDL driver behind it, rumble), then per control what
// each backend saw during the recording (presses, axis ranges, the SDL − libmanette
// latency of each matching transition), then a short rumble attempt through both.

import GLib from 'gi://GLib?version=2.0';
import GjsifyGamepadModule from 'gi://GjsifyGamepad?version=1.0';
import Manette from 'gi://Manette?version=0.2';

import { W3C_AXIS_COUNT } from './axis-mapping.js';
import { W3C_BUTTON_COUNT } from './button-mapping.js';
import { ManetteSource } from './manette-source.js';
import type { GjsifyGamepadNamespace } from './sdl-namespace.js';
import { SdlSource } from './sdl-source.js';
import type { GamepadSource, GamepadSourceDevice, GamepadSourceSink } from './source.js';

const GjsifyGamepad = GjsifyGamepadModule as GjsifyGamepadNamespace & {
    Monitor: { new: () => { update(): void; get_devices(): SdlDevice[]; close(): void } };
};

interface SdlDevice {
    get_name(): string;
    get_guid(): string;
    get_vendor(): number;
    get_product(): number;
    has_rumble(): boolean;
    has_trigger_rumble(): boolean;
}

const SECONDS = Number(GLib.getenv('HARDWARE_CHECK_SECONDS') ?? '20');
const POLL_MS = 4;
const W3C_BUTTON_NAMES = [
    'A/south',
    'B/east',
    'X/west',
    'Y/north',
    'LB',
    'RB',
    'LT',
    'RT',
    'back',
    'start',
    'L3',
    'R3',
    'dpad-up',
    'dpad-down',
    'dpad-left',
    'dpad-right',
    'guide',
];

/** SDL puts its driver in the GUID: byte 14 is 'h' for HIDAPI, 'v' for virtual; 0 is the OS driver (evdev). */
function sdlDriver(guid: string): string {
    const marker = parseInt(guid.slice(28, 30), 16);
    if (marker === 0x68) return 'HIDAPI';
    if (marker === 0x76) return 'virtual';
    return 'linux evdev (no HIDAPI marker in the GUID)';
}

function busName(guid: string): string {
    const bus = parseInt(guid.slice(2, 4) + guid.slice(0, 2), 16);
    return ({ 0x03: 'USB', 0x05: 'Bluetooth' } as Record<number, string>)[bus] ?? `bus 0x${bus.toString(16)}`;
}

// ── 1. Enumeration ────────────────────────────────────────────────────────
console.log('== enumeration ==');
const manetteMonitor = new Manette.Monitor();
const iter = manetteMonitor.iterate();
for (let r = iter.next(); r[0]; r = iter.next()) {
    const d = r[1];
    if (d) console.log(`libmanette: "${d.get_name()}" guid ${d.get_guid()} rumble=${d.has_rumble()}`);
}
const sdlMonitor = GjsifyGamepad.Monitor.new();
sdlMonitor.update();
for (const d of sdlMonitor.get_devices()) {
    const guid = d.get_guid();
    console.log(
        `SDL3:       "${d.get_name()}" ${d.get_vendor().toString(16).padStart(4, '0')}:${d.get_product().toString(16).padStart(4, '0')} ` +
            `guid ${guid} (${busName(guid)}, driver: ${sdlDriver(guid)}) rumble=${d.has_rumble()} trigger-rumble=${d.has_trigger_rumble()}`,
    );
}
sdlMonitor.close();
console.log(`both map to the W3C standard layout: ${W3C_BUTTON_COUNT} buttons, ${W3C_AXIS_COUNT} axes`);

// ── 2. Recording ──────────────────────────────────────────────────────────
interface Transition {
    control: string;
    pressed: boolean;
    at: number;
}

class Recorder implements GamepadSourceSink {
    devices: GamepadSourceDevice[] = [];
    transitions: Transition[] = [];
    pressed = new Set<string>();
    axisMin = Array.from<number>({ length: W3C_AXIS_COUNT }).fill(0);
    axisMax = Array.from<number>({ length: W3C_AXIS_COUNT }).fill(0);
    triggerMax = [0, 0];
    private readonly _down = new Map<number, boolean>();

    connected(device: GamepadSourceDevice): void {
        this.devices.push(device);
    }
    disconnected(device: GamepadSourceDevice): void {
        this.devices = this.devices.filter((d) => d !== device);
    }
    button(_device: GamepadSourceDevice, index: number, value: number, pressed: boolean): void {
        if (index === 6 || index === 7) this.triggerMax[index - 6] = Math.max(this.triggerMax[index - 6], value);
        if ((this._down.get(index) ?? false) === pressed) return;
        this._down.set(index, pressed);
        const control = W3C_BUTTON_NAMES[index] ?? `button ${index}`;
        if (pressed) this.pressed.add(control);
        this.transitions.push({ control, pressed, at: GLib.get_monotonic_time() / 1000 });
    }
    axis(_device: GamepadSourceDevice, index: number, value: number): void {
        this.axisMin[index] = Math.min(this.axisMin[index], value);
        this.axisMax[index] = Math.max(this.axisMax[index], value);
    }
}

const manette = new Recorder();
const sdl = new Recorder();
const manetteSource: GamepadSource = new ManetteSource(Manette);
const sdlSource = new SdlSource(GjsifyGamepad);
manetteSource.start(manette);
sdlSource.start(sdl);

const loop = new GLib.MainLoop(null, false);
if (SECONDS > 0) {
    console.log(
        `\n== recording ${SECONDS} s: press every button, move both sticks to every edge, pull both triggers ==`,
    );
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, POLL_MS, () => {
        sdlSource.poll();
        return GLib.SOURCE_CONTINUE;
    });
    GLib.timeout_add(GLib.PRIORITY_DEFAULT, SECONDS * 1000, () => {
        loop.quit();
        return GLib.SOURCE_REMOVE;
    });
    loop.run();

    const fmt = (r: Recorder, i: number) => `${r.axisMin[i].toFixed(3)}..${r.axisMax[i].toFixed(3)}`;
    console.log('\n== result ==');
    console.log(`libmanette pressed: ${[...manette.pressed].join(', ') || '(nothing)'}`);
    console.log(`SDL3       pressed: ${[...sdl.pressed].join(', ') || '(nothing)'}`);
    const onlyManette = [...manette.pressed].filter((c) => !sdl.pressed.has(c));
    const onlySdl = [...sdl.pressed].filter((c) => !manette.pressed.has(c));
    console.log(`only libmanette: ${onlyManette.join(', ') || '-'}; only SDL3: ${onlySdl.join(', ') || '-'}`);
    for (let i = 0; i < W3C_AXIS_COUNT; i++)
        console.log(`axis ${i}: libmanette ${fmt(manette, i)}  SDL3 ${fmt(sdl, i)}`);
    console.log(
        `triggers max: libmanette LT ${manette.triggerMax[0].toFixed(3)} RT ${manette.triggerMax[1].toFixed(3)}; ` +
            `SDL3 LT ${sdl.triggerMax[0].toFixed(3)} RT ${sdl.triggerMax[1].toFixed(3)}`,
    );
    console.log(`transitions: libmanette ${manette.transitions.length}, SDL3 ${sdl.transitions.length}`);

    // Pair the n-th transition of each control in each backend.
    const deltas: number[] = [];
    const unmatched: string[] = [];
    const byKey = (list: Transition[]) => {
        const map = new Map<string, number[]>();
        for (const t of list) {
            const key = `${t.control}${t.pressed ? '+' : '-'}`;
            map.set(key, [...(map.get(key) ?? []), t.at]);
        }
        return map;
    };
    const m = byKey(manette.transitions);
    const s = byKey(sdl.transitions);
    for (const key of new Set([...m.keys(), ...s.keys()])) {
        const a = m.get(key) ?? [];
        const b = s.get(key) ?? [];
        if (a.length !== b.length) unmatched.push(`${key} libmanette ${a.length}× SDL3 ${b.length}×`);
        for (let i = 0; i < Math.min(a.length, b.length); i++) deltas.push(b[i] - a[i]);
    }
    if (deltas.length > 0) {
        deltas.sort((x, y) => x - y);
        const median = deltas[Math.floor(deltas.length / 2)];
        console.log(
            `latency SDL3 − libmanette over ${deltas.length} matched transitions: ` +
                `min ${deltas[0].toFixed(1)} ms, median ${median.toFixed(1)} ms, max ${deltas[deltas.length - 1].toFixed(1)} ms ` +
                `(SDL is polled every ${POLL_MS} ms here)`,
        );
    }
    console.log(`transition counts that differ: ${unmatched.join('; ') || 'none'}`);
}

// ── 3. Rumble ─────────────────────────────────────────────────────────────
console.log('\n== rumble (500 ms, full strength) ==');
const effect = { duration: 500, strongMagnitude: 1, weakMagnitude: 1 };
for (const [name, rec] of [
    ['libmanette', manette],
    ['SDL3', sdl],
] as const) {
    const actuator = rec.devices[0]?.vibrationActuator;
    if (!actuator) {
        console.log(`${name}: no device or no actuator`);
        continue;
    }
    try {
        const result = await actuator.playEffect('dual-rumble', effect);
        console.log(`${name}: playEffect → ${result}`);
    } catch (error) {
        console.log(`${name}: playEffect rejected: ${String(error)}`);
    }
}

manetteSource.stop();
sdlSource.stop();
