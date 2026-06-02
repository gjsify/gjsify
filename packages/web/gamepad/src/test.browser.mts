// Browser test entry for @gjsify/gamepad.
// In a real browser the Gamepad API is provided natively, so this entry
// exercises the native `navigator.getGamepads()` surface rather than the
// libmanette-backed GJS implementation (which imports `gi://Manette` and is
// GJS-only). Assertions stay valid in a plain browser without any gamepad
// hardware connected: `getGamepads()` returns an array whose slots are all
// `null`, and the `GamepadEvent` constructor is available.
import { run, describe, it, expect } from '@gjsify/unit';

const testSuite = async () => {
    await describe('navigator.getGamepads()', async () => {
        await it('is a function', async () => {
            expect(typeof navigator.getGamepads).toBe('function');
        });

        await it('returns an array', async () => {
            const pads = navigator.getGamepads();
            expect(Array.isArray(pads)).toBe(true);
        });

        await it('has no connected device in a headless browser', async () => {
            const pads = navigator.getGamepads();
            const connected = pads.filter((p) => p !== null);
            expect(connected.length).toBe(0);
        });
    });

    await describe('GamepadEvent', async () => {
        await it('is a constructor', async () => {
            expect(typeof GamepadEvent).toBe('function');
        });

        await it('exposes the event type and is an Event', async () => {
            // A GamepadEvent requires a Gamepad in its init dict; since no
            // device is connected we cannot construct a real Gamepad, but we
            // can still verify the type relationship against Event.
            expect(GamepadEvent.prototype instanceof Event).toBe(true);
        });
    });
};

run({ testSuite });
