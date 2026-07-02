// Ported from `@gjsify/adwaita-nativescript`'s index.spec.ts alongside the
// module move (ADR 0004) — the NS package keeps only a re-export smoke spec.

import { describe, it, expect } from '@gjsify/unit';

import {
    DEFAULT_ICON_COLOR,
    DEFAULT_ICON_COLOR_DARK,
    adwaitaColorScheme,
    isThemeIconColor,
    onAdwaitaColorSchemeChanged,
    setAdwaitaColorScheme,
    themeIconColor,
    toggleAdwaitaColorScheme,
} from './color-scheme.js';

export default async () => {
    await describe('color scheme (light/dark observable)', async () => {
        // Each test restores 'light' so order independence holds.
        await it('defaults to light with the dark fg', () => {
            setAdwaitaColorScheme('light');
            expect(adwaitaColorScheme()).toBe('light');
            expect(themeIconColor()).toBe(DEFAULT_ICON_COLOR);
        });

        await it('switches to the near-white fg in dark', () => {
            setAdwaitaColorScheme('dark');
            expect(adwaitaColorScheme()).toBe('dark');
            expect(themeIconColor()).toBe(DEFAULT_ICON_COLOR_DARK);
            setAdwaitaColorScheme('light');
        });

        await it('toggle flips and returns the new scheme', () => {
            setAdwaitaColorScheme('light');
            expect(toggleAdwaitaColorScheme()).toBe('dark');
            expect(toggleAdwaitaColorScheme()).toBe('light');
        });

        await it('notifies subscribers only on a real change', () => {
            setAdwaitaColorScheme('light');
            let hits = 0;
            const off = onAdwaitaColorSchemeChanged(() => {
                hits++;
            });
            setAdwaitaColorScheme('light'); // no-op, same scheme
            expect(hits).toBe(0);
            setAdwaitaColorScheme('dark');
            expect(hits).toBe(1);
            off();
            setAdwaitaColorScheme('light'); // unsubscribed → no further hit
            expect(hits).toBe(1);
        });

        await it('a throwing subscriber does not break the fan-out', () => {
            setAdwaitaColorScheme('light');
            let hits = 0;
            const offThrowing = onAdwaitaColorSchemeChanged(() => {
                throw new Error('misbehaving subscriber');
            });
            const off = onAdwaitaColorSchemeChanged(() => {
                hits++;
            });
            setAdwaitaColorScheme('dark');
            expect(hits).toBe(1);
            offThrowing();
            off();
            setAdwaitaColorScheme('light');
        });

        await it('isThemeIconColor recognises the scheme defaults, not context colours', () => {
            expect(isThemeIconColor(DEFAULT_ICON_COLOR)).toBe(true);
            expect(isThemeIconColor(DEFAULT_ICON_COLOR_DARK)).toBe(true);
            expect(isThemeIconColor('#3584e4')).toBe(false); // accent — a pinned context colour
            expect(isThemeIconColor('#9a9a9a')).toBe(false); // dim chevron — pinned
        });
    });
};
