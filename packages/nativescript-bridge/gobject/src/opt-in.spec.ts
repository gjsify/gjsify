// `useRealGObjectEngine` — the opt-in's REFUSALS, which need no GI stack at all.
//
// A fake `requireGi` is enough for every assertion here, and that is the point: the one thing
// this function must never do is swallow a failing `requireGi`, and a failing `requireGi` is
// exactly what a device without the `@gjsify/gi-runtime-android` payload has. The SUCCESS path
// over a real GObject is `engine.node-gi.spec.ts`' subject; this file holds what happens when the
// payload is missing, which no node-gi leg can produce on purpose.
//
// It is `.spec.ts` and not `.node-gi.spec.ts` for that reason — it runs on every leg.

import { describe, expect, it } from '@gjsify/unit';
import { registeredEngine, resetRegisteredEngine } from '@gjsify/adwaita-core';

import { useRealGObjectEngine } from './opt-in.js';
import type { RequireGi } from './engine.js';

/** What a device without the AAR does: the addon is not there, so the first reach throws. */
const missingPayload: RequireGi = () => {
    throw new Error("Cannot find module 'system_lib://libnode_gi.so'");
};

export default async () => {
    await describe('useRealGObjectEngine', async () => {
        await it('throws when requireGi cannot reach GObject, instead of falling back', () => {
            resetRegisteredEngine();
            let error: Error | undefined;
            try {
                useRealGObjectEngine(missingPayload);
            } catch (caught) {
                error = caught as Error;
            }
            expect(error !== undefined).toBe(true);
            expect(error?.message.includes('not reachable')).toBe(true);
        });

        await it('names the package that was supposed to deliver the payload', () => {
            resetRegisteredEngine();
            let message = '';
            try {
                useRealGObjectEngine(missingPayload);
            } catch (caught) {
                message = (caught as Error).message;
            }
            expect(message.includes('@gjsify/gi-runtime-android')).toBe(true);
            expect(message.includes('libnode_gi.so')).toBe(true);
            expect(message.includes('girepository-1.0')).toBe(true);
        });

        await it('keeps the original failure as `cause`, so the real reason is not lost', () => {
            resetRegisteredEngine();
            let cause: unknown;
            try {
                useRealGObjectEngine(missingPayload);
            } catch (caught) {
                cause = (caught as { cause?: unknown }).cause;
            }
            expect((cause as Error | undefined)?.message.includes('system_lib://libnode_gi.so')).toBe(true);
        });

        await it('leaves the slot empty after a failed opt-in', () => {
            // A half-registered engine would be worse than none: the port would build a namespace
            // on an engine whose `requireGi` is known broken. Reading the slot freezes it, so this
            // is the last assertion of the file and resets afterwards.
            resetRegisteredEngine();
            try {
                useRealGObjectEngine(missingPayload);
            } catch {
                // asserted above
            }
            expect(registeredEngine()).toBe(undefined);
            resetRegisteredEngine();
        });
    });
};
