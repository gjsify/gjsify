// `SdlSource` on the NODE target, over the REAL `gi://GjsifyGamepad` shim, through
// `@gjsify/node-gi` (ADR 0075 + Amendment 1: SDL3 is the backend on every OS and
// `@gjsify/node-gi` is how a `--app node` bundle reaches a `gi://` namespace at all).
//
// WHY THIS FILE IS SEPARATE FROM `sdl-source.spec.ts`. That suite runs everywhere —
// including a CI runner with no shim at all — so it drives a FAKE namespace. What it
// cannot answer is whether the seam survives a REAL GI load on a second runtime: the
// typelib resolves through node-gi's girepository rather than GJS's, the constructor's
// `GLib.Error` arrives as a node-gi error, `GPtrArray`/`(array)` returns are
// node-gi's marshalling rather than GJS's, and the monitor's 100 ms GLib timeout
// needs a main context that node-gi — not GJS — has to pump. Every one of those is a
// marshalling or mainloop question, and `status/open-todos/gamepad.md` carried
// "the shim under Node: not run yet" precisely because none of it had been.
//
// WHAT IS ASSERTED. The zero-device path, which is ALL a host without a controller can
// prove, and the same path `@gjsify/gamepad-native`'s `monitor-lifecycle-gjs` meson
// test measures under `gjs`: the probe classifies the shim as `sdl` (not `absent`, not
// a fault), the manager starts it, `getGamepads()` returns the conformant EMPTY list,
// and `dispose()` closes the monitor — repeated, because one cycle cannot tell a
// released SDL subsystem from one that leaked it. Input from a real controller is
// ADR 0075's hardware check and is explicitly NOT claimed here.

import { describe, expect, it } from '@gjsify/unit';

import { hasGamepadBackend, loadGamepadBackend } from './backend.js';
import { GamepadManager } from './gamepad-manager.js';
import type { GjsifyGamepadNamespace } from './sdl-namespace.js';
import { SdlSource } from './sdl-source.js';

/**
 * One full start → poll → teardown cycle. The monitor SDL starts, enumerates nothing,
 * and is released, without leaving the process in a state the next cycle cannot repeat.
 */
async function cycle(source: SdlSource): Promise<readonly unknown[]> {
    const manager = new GamepadManager({ source });
    const pads = manager.getGamepads();
    manager.dispose();
    return pads;
}

/**
 * Let the monitor's own 100 ms GLib timeout run. Under `gjs` the gjs meson test
 * spins a `GLib.MainLoop`; on Node there is no such loop to run — node-gi's uv pump
 * is what drains the thread-default context (`packages/node-gi/AGENTS.md` § mainloop,
 * the non-blocking case), so an ordinary timer is the equivalent wait here.
 */
async function spinMainContext(ms: number): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, ms));
}

export default async () => {
    await describe('SdlSource on Node via @gjsify/node-gi', async () => {
        await it('classifies the shim as the backend, not as absent', async () => {
            const backend = await loadGamepadBackend();
            // The needle here is the CLASSIFICATION, not the text: `absent` is what a
            // host without the `@gjsify/gamepad-native` prebuild answers, and it looks
            // identical from JS (`hasGamepadBackend()` false, empty list) until you ask
            // which of the two it was.
            expect(backend.status).toBe('sdl');
            expect(backend.error).toBeNull();
            expect(backend.diagnostic).toBeNull();
            expect(typeof (backend.module as GjsifyGamepadNamespace).Monitor).toBe('function');
        });

        await it('answers hasGamepadBackend() true through node-gi', async () => {
            expect(await hasGamepadBackend()).toBe(true);
        });

        await it('initialises, enumerates zero controllers, and tears down, over repeated cycles', async () => {
            const { module } = await loadGamepadBackend();
            const source = new SdlSource(module as GjsifyGamepadNamespace);
            for (let i = 0; i < 20; i++) {
                // The W3C list is empty until an index is selected for a connected
                // device — a driverless host must answer `[]`, never a pre-filled
                // four-slot array and never a throw.
                expect(await cycle(source)).toStrictEqual([]);
            }
        });

        await it('pumps the monitor between polls on a node-gi-drained main context', async () => {
            const { module } = await loadGamepadBackend();
            const source = new SdlSource(module as GjsifyGamepadNamespace);
            const manager = new GamepadManager({ source });
            expect(manager.getGamepads()).toStrictEqual([]);
            // Three timeout periods. On a host with no controller the observable is
            // only that the timeout fires against a live monitor without fault and
            // that close() afterwards removes it — a source left behind would keep
            // calling update() on a closed monitor. Same observable the gjs meson test
            // asserts, and the reason it cannot be a one-liner is identical.
            await spinMainContext(350);
            expect(manager.getGamepads()).toStrictEqual([]);
            manager.dispose();
            // A second manager starts a fresh monitor after the first was disposed.
            expect(await cycle(source)).toStrictEqual([]);
        });
    });
};
