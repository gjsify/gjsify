// The Android half of the system accent and contrast, held against hosts the NativeScript runtime
// really produces: one without `android.R` (its metadata exposes no inner classes), one that answers.

import { describe, expect, it } from '@gjsify/unit';

import { systemAccent, systemHighContrast, type AndroidContext, type AndroidGlobals } from './widgets/system-accent.js';

const android = (sdk: number): AndroidGlobals => ({ os: { Build: { VERSION: { SDK_INT: sdk } } } });

// libadwaita's blue, #3584e4.
const BLUE = 0xff3584e4 | 0;

function context(id: number, argb: number, contrast = 0): AndroidContext {
    return {
        getSystemService: () => ({ getContrast: () => contrast }),
        getResources: () => ({ getIdentifier: (name) => (name === 'system_accent1_500' ? id : 0) }),
        getColor: () => argb,
    };
}

export default async () => {
    await describe('adwaita-nativescript: system accent without android.R', async () => {
        await it('maps the resource found by name to the nearest accent', () => {
            expect(systemAccent(android(36), context(0x0106001c, BLUE))).toBe('blue');
        });

        await it('is none when the device has no such resource', () => {
            expect(systemAccent(android(36), context(0, BLUE))).toBe(null);
        });

        await it('is none below Android 12, off Android and without a context', () => {
            expect(systemAccent(android(30), context(1, BLUE))).toBe(null);
            expect(systemAccent(undefined, context(1, BLUE))).toBe(null);
            expect(systemAccent(android(36), null)).toBe(null);
        });

        await it('does not throw on a host that exposes neither resources nor colors', () => {
            const bare: AndroidContext = { getSystemService: () => null };
            expect(systemAccent(android(36), bare)).toBe(null);
            expect(systemAccent({}, bare)).toBe(null);
        });
    });

    await describe('adwaita-nativescript: system high contrast', async () => {
        await it('is the top contrast level on Android 14', () => {
            expect(systemHighContrast(android(34), context(0, BLUE, 1))).toBe(true);
            expect(systemHighContrast(android(34), context(0, BLUE, 0.5))).toBe(false);
        });

        await it('is false before Android 14, off Android and without a context', () => {
            expect(systemHighContrast(android(33), context(0, BLUE, 1))).toBe(false);
            expect(systemHighContrast(undefined, context(0, BLUE, 1))).toBe(false);
            expect(systemHighContrast(android(36), null)).toBe(false);
        });
    });
};
