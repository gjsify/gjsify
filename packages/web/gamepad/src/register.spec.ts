// oxlint-disable typescript/no-explicit-any -- /register existence probes: the
// side-effect import patches `navigator.getGamepads` and registers `GamepadEvent`
// onto `globalThis`. The assertions read through an untyped host object because
// the point is to verify the WRITES happened — typing each access against lib.dom
// would mask a missed registration. Same precedent as @gjsify/webrtc's
// register.spec.ts and #348's @gjsify/globals register-existence file-level disable.
//
// Gamepad globals registration tests — verifies the /register subpath wires
// navigator.getGamepads + GamepadEvent, and that the patched method survives a
// host with no gamepad backend.

import { describe, expect, it } from '@gjsify/unit';

import '@gjsify/gamepad/register';
import { hasGamepadBackend } from '@gjsify/gamepad';

export default async () => {
    await describe('@gjsify/gamepad/register', async () => {
        await it('patches navigator.getGamepads', async () => {
            expect(typeof (globalThis as any).navigator?.getGamepads).toBe('function');
        });

        await it('registers GamepadEvent', async () => {
            expect(typeof (globalThis as any).GamepadEvent).toBe('function');
        });

        await it('navigator.getGamepads() returns a list, never throws', async () => {
            // THE anti-throw guard for this package. `getGamepads()` must answer
            // the W3C shape on every host, including one with no gamepad backend
            // at all: the spec's steps only ever return a list (the sole throw is
            // a SecurityError for the "gamepad" permission policy), and a browser
            // on a driverless machine returns the same empty answer — WebKit
            // compiles an EmptyGamepadProvider for exactly that case. A page
            // doing `navigator.getGamepads().length` breaks if this ever throws.
            const pads = (globalThis as any).navigator.getGamepads();
            expect(Array.isArray(pads)).toBe(true);
            expect(pads).toHaveLength(4);
        });

        await it('exposes hasGamepadBackend() from the package root', async () => {
            // The barrel export is part of the contract: the reason behind an
            // empty getGamepads() has to be reachable where the API is.
            expect(typeof hasGamepadBackend).toBe('function');
            expect(typeof (await hasGamepadBackend())).toBe('boolean');
        });
    });
};
