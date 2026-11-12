import { describe, expect, it } from '@gjsify/unit';

import {
    APP_SCALE_MAX,
    APP_SCALE_MIN,
    appScaleChoices,
    clampAppScale,
    deriveAppScale,
    parseAppScaleSetting,
    resolveAppScale,
    scaleDip,
} from './app-scale.js';

export default async () => {
    await describe('deriveAppScale', async () => {
        await it('asks a Galaxy S9 (411.4 dp) for the 360 dp stylesheet at 1.14', () => {
            expect(deriveAppScale({ widthDips: 411.429, heightDips: 845.714 })).toBe(1.143);
        });
        await it('leaves a 360 dp phone at 1', () => {
            expect(deriveAppScale({ widthDips: 360, heightDips: 740 })).toBe(1);
        });
        await it('never shrinks a narrow phone below the authored size', () => {
            expect(deriveAppScale({ widthDips: 320, heightDips: 568 })).toBe(APP_SCALE_MIN);
        });
        await it('leaves a tablet at 1 — a wide window is what the sheet is written for', () => {
            expect(deriveAppScale({ widthDips: 1024, heightDips: 768 })).toBe(1);
            expect(deriveAppScale({ widthDips: 600, heightDips: 960 })).toBe(1);
        });
        await it('reads the shortest edge, so turning the device does not resize the app', () => {
            expect(deriveAppScale({ widthDips: 845.714, heightDips: 411.429 })).toBe(1.143);
        });
        await it('falls back to 1 on a screen that reports nothing usable', () => {
            expect(deriveAppScale({ widthDips: 0, heightDips: 0 })).toBe(1);
            expect(deriveAppScale({ widthDips: Number.NaN, heightDips: 800 })).toBe(1);
        });
    });

    await describe('clampAppScale', async () => {
        await it('holds the factor between the authored size and 1.5', () => {
            expect(clampAppScale(0.5)).toBe(APP_SCALE_MIN);
            expect(clampAppScale(3)).toBe(APP_SCALE_MAX);
            expect(clampAppScale(1.25)).toBe(1.25);
        });
        await it('rounds to three decimals', () => {
            expect(clampAppScale(411.429 / 360)).toBe(1.143);
        });
        await it('answers 1 for a value that is not a number', () => {
            expect(clampAppScale(Number.NaN)).toBe(1);
        });
    });

    await describe('resolveAppScale', async () => {
        await it('takes the derived default when the setting is auto', () => {
            expect(resolveAppScale('auto', 1.143)).toBe(1.143);
        });
        await it('takes the user override over the default', () => {
            expect(resolveAppScale(1.5, 1.143)).toBe(1.5);
            expect(resolveAppScale(1, 1.143)).toBe(1);
        });
        await it('clamps an override the same way, so a stored value cannot shrink the app', () => {
            expect(resolveAppScale(0.25, 1.143)).toBe(APP_SCALE_MIN);
            expect(resolveAppScale(9, 1.143)).toBe(APP_SCALE_MAX);
        });
        await it('resetting to auto gives the default back', () => {
            const derived = deriveAppScale({ widthDips: 411.429, heightDips: 845.714 });
            expect(resolveAppScale(1.5, derived)).toBe(1.5);
            expect(resolveAppScale('auto', derived)).toBe(1.143);
        });
    });

    await describe('scaleDip', async () => {
        await it('scales a length the code sets, like the sheet next to it', () => {
            expect(scaleDip(16, 1.143)).toBe(18.288);
            expect(scaleDip(48, 1.143)).toBe(54.864);
            expect(scaleDip(128, 1.5)).toBe(192);
        });
        await it('leaves a length alone at the authored scale', () => {
            expect(scaleDip(16, 1)).toBe(16);
        });
        await it('rounds to three decimals, as the CSS lengths do', () => {
            expect(scaleDip(11, 1.143)).toBe(12.573);
        });
        await it('hands a length back unchanged when either side is not a number', () => {
            expect(scaleDip(16, Number.NaN)).toBe(16);
            expect(scaleDip(Number.NaN, 1.143)).toBeNaN();
        });
    });

    await describe('appScaleChoices', async () => {
        await it('runs from the authored size to the ceiling in tenths', () => {
            expect(appScaleChoices()).toStrictEqual([1, 1.1, 1.2, 1.3, 1.4, 1.5]);
        });
        await it('reaches the ceiling with a step that does not divide the range', () => {
            expect(appScaleChoices(0.3)).toStrictEqual([1, 1.3, 1.5]);
        });
        await it('offers nothing the clamp would refuse', () => {
            for (const choice of appScaleChoices(0.05)) expect(clampAppScale(choice)).toBe(choice);
        });
        await it('falls back to tenths for a step that is not a positive number', () => {
            expect(appScaleChoices(0)).toStrictEqual([1, 1.1, 1.2, 1.3, 1.4, 1.5]);
            expect(appScaleChoices(Number.NaN)).toStrictEqual([1, 1.1, 1.2, 1.3, 1.4, 1.5]);
        });
    });

    await describe('parseAppScaleSetting', async () => {
        await it('reads back what the app stored', () => {
            expect(parseAppScaleSetting('auto')).toBe('auto');
            expect(parseAppScaleSetting(1.25)).toBe(1.25);
            expect(parseAppScaleSetting('1.25')).toBe(1.25);
        });
        await it('treats anything else as auto', () => {
            expect(parseAppScaleSetting(undefined)).toBe('auto');
            expect(parseAppScaleSetting('')).toBe('auto');
            expect(parseAppScaleSetting('wide')).toBe('auto');
        });
    });
};
