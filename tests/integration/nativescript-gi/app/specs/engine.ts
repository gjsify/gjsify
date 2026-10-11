// WHICH ENGINE BACKS THIS APP — the runtime query of ADR 0105 stage 4, asked on the device.
//
// Two surfaces answer it and both are asserted, because they are reached by different consumers:
// `gobjectEngineName()` is the core's own answer, and `engineName` on the NativeScript port's
// `GObject` namespace is what an app that imports only the port can read. If the two ever
// disagreed, the port would have built its namespace on an engine the core does not know about.
//
// THE PORT IS IMPORTED HERE ON PURPOSE, and it is the reason this spec is worth running twice.
// `@gjsify/adwaita-nativescript/gobject` calls `registeredEngine()` in its MODULE BODY: the slot
// freezes there, and whether it freezes on the real engine or on the default is decided purely by
// whether `app/opt-in.ts` was evaluated first. That ordering is the app's duty under this design,
// unverifiable by any unit test, and this is where it is verified — the port reporting 'real-gio'
// is stage 4's actual claim.
import { gobjectEngineName, registeredEngine } from '@gjsify/adwaita-core';
import * as GObject from '@gjsify/adwaita-nativescript/gobject';
import { useRealGObjectEngine } from '@gjsify/adwaita-gobject-native';

import { describe, expect, info, it } from '../reporter.js';
import { optedIn, requireGi } from '../opt-in.js';

/**
 * @param expected the engine name this run must report — `'real-gio'` when the app opted in,
 *   `'pure-js'` for the control run, which is the same APK with the opt-in define flipped.
 */
export const engineSpec = (expected: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`the engine behind the subset: expecting '${expected}'`, async () => {
        info(`gobjectEngineName() = ${gobjectEngineName()}`);
        info(`GObject.engineName = ${GObject.engineName}`);
        info(`registeredEngine() = ${registeredEngine()?.name ?? '<none>'}`);

        await it(`the core reports '${expected}'`, () => {
            expect(gobjectEngineName()).toBe(expected);
        });

        await it(`the NativeScript port's GObject reports '${expected}'`, () => {
            expect(GObject.engineName).toBe(expected);
        });

        await it(
            optedIn
                ? 'the slot holds the engine the opt-in registered'
                : 'the slot is empty, so the port fell back to the default',
            () => {
                expect(registeredEngine()?.name ?? '<none>').toBe(optedIn ? 'real-gio' : '<none>');
            },
        );

        if (optedIn) {
            await it('a second opt-in is refused rather than swapping the engine', () => {
                // `useRealGObjectEngine` builds a NEW engine every call, so this is the "different
                // second engine" case: the slot must throw and name both, and the app must still
                // be backed by the engine it already had. Silently accepting the swap is the
                // failure mode where half the app's classes live on one engine and half on
                // another — every one of them would still pass its own vectors.
                let message = '';
                try {
                    useRealGObjectEngine(requireGi);
                } catch (error) {
                    message = error instanceof Error ? error.message : String(error);
                }
                info(`second opt-in said: ${message}`);
                expect(message).toContain('already registered');
                expect(gobjectEngineName()).toBe('real-gio');
            });
        }
    });
};
