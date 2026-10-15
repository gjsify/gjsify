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
import {
    engineForTarget,
    gobjectEngineName,
    registerGObjectEngine,
    registeredEngine,
    resetRegisteredEngine,
} from '@gjsify/adwaita-core';
import { ENGINE_TARGET } from '@gjsify/adwaita-nativescript';
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
                : 'the slot holds the subset the opt-OUT registered',
            () => {
                // Since ADR 0110 § 1 the control leg is not an empty slot any more. It cannot be:
                // on Android an empty slot is a refusal, so "run on the subset" has to be said.
                expect(registeredEngine()?.name ?? '<none>').toBe(expected);
            },
        );

        await it('this build defaults to real GObject, because it is an Android build', () => {
            // The bundle-time half of the decision, and the only place it can be checked: the
            // unit suite sees both `engine-target` files, a device sees the ONE that NativeScript's
            // platform resolution put in the APK. If this is ever false here, the port on Android
            // is back to silently defaulting to the subset.
            info(`ENGINE_TARGET = ${ENGINE_TARGET.name} (real default: ${ENGINE_TARGET.realGObjectIsDefault})`);
            expect(ENGINE_TARGET.realGObjectIsDefault).toBe(true);
        });

        await it('refuses an app that registered NOTHING, on the device, naming both calls', () => {
            // ADR 0105's no-silent-fallback rule applied to the decision itself. Asserted on the
            // device rather than only in the unit suite because the thing being refused is a
            // REAL-WORLD build mistake — an APK that carries the payload and forgot the call —
            // and the refusal has to survive the bundler, the minifier and the NS module loader
            // with its message intact, since that message is all the author will ever see.
            const held = registeredEngine();
            resetRegisteredEngine();
            let message = '';
            try {
                engineForTarget(ENGINE_TARGET);
            } catch (error) {
                message = error instanceof Error ? error.message : String(error);
            }
            // Put the leg's own engine back before asserting, so a failure here cannot leave the
            // remaining specs on a different engine than the one this leg is measuring.
            resetRegisteredEngine();
            if (held !== undefined) registerGObjectEngine(held);
            info(`empty slot said: ${message}`);
            expect(message).toContain('useRealGObjectEngine');
            expect(message).toContain('usePureJsGObjectEngine');
            expect(gobjectEngineName()).toBe(expected);
        });

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
