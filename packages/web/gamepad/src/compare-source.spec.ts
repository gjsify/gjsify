// Coverage for `ComparingSource` — the Linux comparison ADR 0075 Amendment 1 requires
// before libmanette is removed. Two scripted sources stand in for libmanette and the SDL3
// shim; what is pinned is what the comparison PROMISES: the page sees the primary alone,
// a disagreement is reported once it holds, a one-frame skew is not, and a shadow that
// cannot start leaves the primary running.

import { describe, expect, it } from '@gjsify/unit';

import { ComparingSource } from './compare-source.js';
import { GamepadManager } from './gamepad-manager.js';
import type { GamepadSource, GamepadSourceDevice, GamepadSourceSink } from './source.js';

function device(id: string, model?: string): GamepadSourceDevice {
    return { id, vibrationActuator: null, model };
}

/** Reports `present` on start; the test drives the rest through `sink`. */
class Scripted implements GamepadSource {
    sink: GamepadSourceSink | null = null;
    stops = 0;
    polls = 0;
    failStart: Error | null = null;

    constructor(
        readonly name: string,
        readonly present: GamepadSourceDevice[],
    ) {}

    start(sink: GamepadSourceSink): void {
        if (this.failStart) throw this.failStart;
        this.sink = sink;
        for (const d of this.present) sink.connected(d);
    }

    poll(): void {
        this.polls++;
    }

    stop(): void {
        this.stops++;
        this.sink = null;
    }
}

function pair() {
    const manettePad = device('Manette Pad');
    const sdlPad = device('SDL Pad');
    const manette = new Scripted('gi://Manette', [manettePad]);
    const sdl = new Scripted('gi://GjsifyGamepad', [sdlPad]);
    const lines: string[] = [];
    const source = new ComparingSource(manette, sdl, (line) => lines.push(line));
    return { manettePad, sdlPad, manette, sdl, lines, source };
}

export default async () => {
    await describe('ComparingSource (Linux: libmanette against the SDL3 shim)', async () => {
        await it('drives the page from the primary alone', async () => {
            const { manette, sdl, sdlPad, source } = pair();
            const manager = new GamepadManager({ source });
            manager.getGamepads();
            await Promise.resolve();
            manette.sink?.button(manette.present[0], 0, 1, true);
            // The shadow reports a different button; the page must not see it.
            sdl.sink?.button(sdlPad, 3, 1, true);
            const [pad] = manager.getGamepads();
            expect(pad?.id).toBe('Manette Pad');
            expect(pad?.buttons[0].pressed).toBe(true);
            expect(pad?.buttons[3].pressed).toBe(false);
            expect(manager.getGamepads()).toHaveLength(1);
            manager.dispose();
            expect(manette.stops).toBe(1);
            expect(sdl.stops).toBe(1);
        });

        await it('reports a disagreement once it holds for two polls, and only once', async () => {
            const { manette, sdl, manettePad, sdlPad, lines, source } = pair();
            source.start({ connected() {}, disconnected() {}, button() {}, axis() {} });
            lines.length = 0;
            // libmanette reads the stick right, SDL reads it left: a real mapping bug.
            manette.sink?.axis(manettePad, 0, 1);
            sdl.sink?.axis(sdlPad, 0, -1);
            source.poll();
            expect(lines).toStrictEqual([]);
            source.poll();
            expect(lines).toStrictEqual(['"Manette Pad" vs "SDL Pad": axis 0: 1.00 vs -1.00']);
            source.poll();
            source.poll();
            expect(lines).toHaveLength(1);
            // Agreement again is said once too.
            sdl.sink?.axis(sdlPad, 0, 1);
            source.poll();
            source.poll();
            expect(lines[1]).toBe('the two backends agree again');
            expect(manette.polls).toBe(6);
            expect(sdl.polls).toBe(6);
            source.stop();
        });

        await it('does not report a one-frame skew, nor a difference within the scaling tolerance', async () => {
            const { manette, sdl, manettePad, sdlPad, lines, source } = pair();
            source.start({ connected() {}, disconnected() {}, button() {}, axis() {} });
            lines.length = 0;
            // Manette pushed a press the SDL poll has not caught up with yet…
            manette.sink?.button(manettePad, 0, 1, true);
            source.poll();
            // …and by the next poll it has.
            sdl.sink?.button(sdlPad, 0, 1, true);
            source.poll();
            // A centred stick: evdev normalisation vs SDL's int16 rescale.
            manette.sink?.axis(manettePad, 1, 0.004);
            sdl.sink?.axis(sdlPad, 1, -0.003);
            source.poll();
            source.poll();
            expect(lines).toStrictEqual([]);
            source.stop();
        });

        await it('reports a controller only one backend can see', async () => {
            const manette = new Scripted('gi://Manette', [device('A'), device('B')]);
            const sdl = new Scripted('gi://GjsifyGamepad', [device('A')]);
            const lines: string[] = [];
            const source = new ComparingSource(manette, sdl, (line) => lines.push(line));
            source.start({ connected() {}, disconnected() {}, button() {}, axis() {} });
            source.poll();
            source.poll();
            expect(lines).toContain('gi://Manette sees 2 controller(s), gi://GjsifyGamepad sees 1');
            source.stop();
        });

        await it('pairs two controllers by model, not by the order each backend lists them', async () => {
            const [m360, mN30] = [
                device('Microsoft X-Box 360 pad', '045e:028e'),
                device('8BitDo N30 Pro 2', '2dc8:2865'),
            ];
            const [sN30, s360] = [device('8BitDo N30 Pro 2', '2dc8:2865'), device('Xbox 360 Controller', '045e:028e')];
            const manette = new Scripted('gi://Manette', [m360, mN30]);
            const sdl = new Scripted('gi://GjsifyGamepad', [sN30, s360]);
            const lines: string[] = [];
            const source = new ComparingSource(manette, sdl, (line) => lines.push(line));
            source.start({ connected() {}, disconnected() {}, button() {}, axis() {} });
            lines.length = 0;
            manette.sink?.axis(m360, 2, 1);
            sdl.sink?.axis(s360, 2, 1);
            source.poll();
            source.poll();
            expect(lines).toStrictEqual([]);
            source.stop();
        });

        await it('keeps the primary running when the shadow cannot start', async () => {
            const { manette, sdl, source, lines } = pair();
            sdl.failStart = new Error('SDL gamepad subsystem did not start: no udev');
            const manager = new GamepadManager({ source });
            manager.getGamepads();
            await Promise.resolve();
            expect(manager.getGamepads()[0]?.id).toBe('Manette Pad');
            expect(lines.some((l) => l.includes('did not start') && l.includes('no udev'))).toBe(true);
            // The failed shadow is never polled.
            manager.getGamepads();
            expect(sdl.polls).toBe(0);
            expect(manette.polls > 0).toBe(true);
            manager.dispose();
        });
    });
};
