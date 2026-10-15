// WHICH TARGET DEFAULTS TO WHICH ENGINE (ADR 0110 § 1) — the per-platform half of the decision
// the core's `engine-slot.spec.ts` tests the mechanism of.
//
// ALL THREE VARIANTS ARE IMPORTED HERE, which no bundle ever does: on a device, NativeScript's
// platform file resolution has already picked one and the others do not exist in the APK. That
// is exactly why they are worth asserting side by side off-device — each file is one line of
// answer, and a build that silently resolved the wrong one is indistinguishable from a wrong
// answer at this level. The run that proves the RESOLUTION is the dual-engine device harness in
// `tests/integration/nativescript-gi` (#2234), where the port reports `engineName`.

import { describe, expect, it } from '@gjsify/unit';

import { ENGINE_TARGET as ANDROID_TARGET } from './engine-target.android.js';
import { ENGINE_TARGET as IOS_TARGET } from './engine-target.ios.js';
import { ENGINE_TARGET as BASE_TARGET } from './engine-target.js';

export default async () => {
    await describe('the engine target a build carries', async () => {
        await it('makes real GObject the default on NativeScript Android', () => {
            expect(ANDROID_TARGET.realGObjectIsDefault).toBe(true);
            expect(ANDROID_TARGET.name).toBe('NativeScript Android');
        });

        await it('leaves iOS and a host that is neither on the pure-JS subset', () => {
            // ADR 0105 § 6 for iOS, and there is no node-gi payload for either, so an empty slot
            // there is still an answer and not a missing decision.
            expect(IOS_TARGET.realGObjectIsDefault).toBe(false);
            expect(BASE_TARGET.realGObjectIsDefault).toBe(false);
        });

        await it('names itself, because the refusal quotes that name', () => {
            // `engineForTarget`'s message is the only thing an app sees when the decision is
            // missing; a target whose name said nothing would make it unactionable.
            for (const target of [ANDROID_TARGET, IOS_TARGET, BASE_TARGET]) {
                expect(target.name.length > 0).toBe(true);
            }
        });
    });
};
