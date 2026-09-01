// Gamepad globals registration tests — verifies the /register subpath wires
// navigator.getGamepads + GamepadEvent, and that the patched method survives a
// host with no gamepad backend.
//
// The host globals are read through a typed VIEW, not as `globalThis.X`: the
// `--globals auto` detector treats `globalThis.<KnownGlobal>` as a free global
// (Pattern A in `detect-free-globals.ts`) and `navigator.getGamepads` as a method
// marker, so probing them directly makes the CLI inject the GTK/GNOME-backed register
// set — gi://Gdk, gi://GdkPixbuf, gi://Manette, gi://Pango, gi://PangoCairo at load —
// into the test bundle. For the one package whose subject is "behave observably where
// Manette is absent", a bundle announcing a load-time Manette requirement is the wrong
// artefact, and the injection is redundant because this file imports
// `@gjsify/gamepad/register` EXPLICITLY. The local alias removes the trigger at the
// source, with no build flag to remember, and still asserts that the side-effect import
// WROTE onto the host object.

import { describe, expect, it } from '@gjsify/unit';

import '@gjsify/gamepad/register';
import { hasGamepadBackend, type Gamepad as GjsifyGamepad } from '@gjsify/gamepad';

/** Untyped-on-purpose view of the globals `/register` is supposed to write. */
interface HostGlobals {
    navigator?: { getGamepads?: () => (GjsifyGamepad | null)[] };
    GamepadEvent?: unknown;
}

const host = globalThis as unknown as HostGlobals;

export default async () => {
    await describe('@gjsify/gamepad/register', async () => {
        await it('patches navigator.getGamepads', async () => {
            expect(typeof host.navigator?.getGamepads).toBe('function');
        });

        await it('registers GamepadEvent', async () => {
            expect(typeof host.GamepadEvent).toBe('function');
        });

        await it('navigator.getGamepads() returns a list, never throws', async () => {
            // THE anti-throw guard for this package. `getGamepads()` must answer
            // the W3C shape on every host, including one with no gamepad backend
            // at all: the spec's steps only ever return a list (the sole throw is
            // a SecurityError for the "gamepad" permission policy), and a browser
            // on a driverless machine returns the same empty answer — WebKit
            // compiles an EmptyGamepadProvider for exactly that case. A page
            // doing `navigator.getGamepads().length` breaks if this ever throws.
            const pads = host.navigator!.getGamepads!();
            expect(Array.isArray(pads)).toBe(true);
            // And the length is the spec's, not Chrome's: `[[gamepads]]` starts
            // EMPTY and only grows when an index is selected for a connected
            // device. So a non-empty list here must be backed by a real device —
            // the four fabricated `null` ports this used to assert would fail.
            expect(pads.length === 0 || pads.some((pad) => pad !== null)).toBe(true);
        });

        await it('exposes hasGamepadBackend() and agrees with this host, quietly', async () => {
            // The barrel export is part of the contract: the reason behind an
            // empty getGamepads() has to be reachable where the API is.
            expect(typeof hasGamepadBackend).toBe('function');

            // Not `typeof … === 'boolean'`, which passed for true, false AND a
            // faulted probe. Ask the LIVE loader what this host has and require
            // the capability export to agree — so it holds on a runner WITH
            // libmanette (true) and on one without (false), and fails if the
            // export ever stops reflecting reality.
            let liveBackend = true;
            try {
                await import('gi://Manette?version=0.2');
            } catch {
                liveBackend = false;
            }

            // Let the manager's deliberately un-awaited init settle first: on a
            // host with no backend the previous test's `getGamepads()` legitimately
            // emits the one-time line, and capturing it here would be measuring the
            // USE, not the query.
            for (let i = 0; i < 8; i++) await Promise.resolve();

            // …and asking must stay SILENT: this is the usage the README
            // recommends, and it must not print on every macOS/Windows start.
            const warnings: string[] = [];
            const errors: string[] = [];
            const origWarn = console.warn;
            const origError = console.error;
            console.warn = (...args: unknown[]) => warnings.push(args.map(String).join(' '));
            console.error = (...args: unknown[]) => errors.push(args.map(String).join(' '));
            let answer: boolean;
            try {
                answer = await hasGamepadBackend();
            } finally {
                console.warn = origWarn;
                console.error = origError;
            }
            expect(answer).toBe(liveBackend);
            expect(warnings).toStrictEqual([]);
            expect(errors).toStrictEqual([]);
        });
    });
};
