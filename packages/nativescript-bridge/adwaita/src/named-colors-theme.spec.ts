// The NativeScript named-colour override: parsing, rule generation, accent derivation and the
// append-only publisher.
//
// IMPORTANT: this file must NOT import `./platform-host.js` (it imports `@nativescript/core`).

import { describe, expect, it } from '@gjsify/unit';

import { adwaitaAccentBgColor } from '@gjsify/adwaita-core';
import { adwaitaNsAccentColor, adwaitaNsAccentCss } from './widgets/accent-theme.js';
import {
    ADWAITA_NS_NAMED_COLOR_RULES,
    adwaitaNsNamedColorsCss,
    adwaitaNsSurfaceCss,
    createNamedColorsPublisher,
    parseAdwaitaRootColors,
} from './widgets/named-colors-theme.js';

const values = (entries: Record<string, string>) => new Map(Object.entries(entries));

export default async () => {
    await describe('parseAdwaitaRootColors', async () => {
        await it('reads literal colours from :root', () => {
            const parsed = parseAdwaitaRootColors(
                ':root { --window-bg-color: #f3e6f5; --window-fg-color: rgba(0,0,0,0.8); }',
            );
            expect(parsed.get('window-bg-color')).toBe('#f3e6f5');
            expect(parsed.get('window-fg-color')).toBe('rgba(0,0,0,0.8)');
        });

        await it('drops var() and color-mix() values', () => {
            const parsed = parseAdwaitaRootColors(
                ':root { --a-color: var(--b); --c-color: color-mix(in srgb, red, blue); --d-color: #fff; }',
            );
            expect(parsed.size).toBe(1);
            expect(parsed.get('d-color')).toBe('#fff');
        });

        await it('ignores comments and non-root rules; later declarations win', () => {
            const parsed = parseAdwaitaRootColors(
                '/* :root { --x-color: #000000; } */ .a { --y-color: #111111; } :root { --z-color: #222222; } :root { --z-color: #333333 }',
            );
            expect(parsed.has('x-color')).toBe(false);
            expect(parsed.has('y-color')).toBe(false);
            expect(parsed.get('z-color')).toBe('#333333');
        });

        await it('normalises accent values to #rrggbb', () => {
            expect(
                parseAdwaitaRootColors(':root { --accent-bg-color: rgb(145, 65, 172); }').get('accent-bg-color'),
            ).toBe('#9141ac');
        });
    });

    await describe('adwaitaNsSurfaceCss', async () => {
        await it('emits one rule per table entry, scoped selectors verbatim', () => {
            const lines = adwaitaNsSurfaceCss(new Map()).split('\n');
            expect(lines.length).toBe(ADWAITA_NS_NAMED_COLOR_RULES.length);
            for (const rule of ADWAITA_NS_NAMED_COLOR_RULES) {
                expect(lines.some((line) => line.startsWith(`${rule.selector} {`))).toBe(true);
            }
        });

        await it('paints a set variable on both the light and the .ns-dark selector', () => {
            const css = adwaitaNsSurfaceCss(values({ 'window-bg-color': '#f3e6f5' }));
            expect(css.includes('.adw-toolbar-view { background-color: #f3e6f5; }')).toBe(true);
            expect(css.includes('.ns-dark .adw-toolbar-view { background-color: #f3e6f5; }')).toBe(true);
        });

        await it('falls back to the theme literal for an unset variable', () => {
            const css = adwaitaNsSurfaceCss(values({ 'window-bg-color': '#f3e6f5' }));
            expect(css.includes('.adw-sidebar { background-color: #ebebed; }')).toBe(true);
        });
    });

    await describe('accent from an arbitrary colour', async () => {
        await it('derives the roles from the given fill', () => {
            expect(adwaitaNsAccentColor('#9141ac', 'fill')).toBe(adwaitaAccentBgColor('purple'));
            expect(adwaitaNsAccentColor('#9141ac', 'shade')).toBe(adwaitaNsAccentColor('purple', 'shade'));
            expect(adwaitaNsAccentColor('#9141ac', 'standalone-dark')).toBe(
                adwaitaNsAccentColor('purple', 'standalone-dark'),
            );
        });

        await it('keeps the named form working and rejects garbage', () => {
            expect(adwaitaNsAccentCss('purple')).toBe(adwaitaNsAccentCss('#9141ac'));
            let threw = false;
            try {
                adwaitaNsAccentColor('not-a-colour', 'fill');
            } catch {
                threw = true;
            }
            expect(threw).toBe(true);
        });

        await it('lets --accent-color replace the standalone-dark role only', () => {
            const css = adwaitaNsAccentCss('purple', { standaloneDark: '#abcdef' });
            expect(css.includes('#abcdef')).toBe(true);
            expect(css.includes(adwaitaAccentBgColor('purple'))).toBe(true);
        });
    });

    await describe('createNamedColorsPublisher', async () => {
        await it('appends nothing until a variable is set', () => {
            const publisher = createNamedColorsPublisher();
            expect(publisher.update(new Map())).toBe(null);
            expect(publisher.update(values({ 'unknown-color': '#000000' }))).toBe(null);
        });

        await it('does not re-append identical output, unless forced', () => {
            const publisher = createNamedColorsPublisher();
            const set = values({ 'window-bg-color': '#f3e6f5' });
            expect(publisher.update(set) === null).toBe(false);
            expect(publisher.update(set)).toBe(null);
            expect(publisher.update(set, true) === null).toBe(false);
        });

        await it('appends the defaults once when every variable goes away', () => {
            const publisher = createNamedColorsPublisher();
            publisher.update(values({ 'window-bg-color': '#f3e6f5' }));
            const restored = publisher.update(new Map());
            expect(restored).toBe(adwaitaNsNamedColorsCss(new Map(), false));
            expect(restored!.includes('.adw-sidebar { background-color: #ebebed; }')).toBe(true);
            expect(publisher.update(new Map())).toBe(null);
        });

        await it('leaves the accent alone until the app sets one, then undoes it', () => {
            const publisher = createNamedColorsPublisher();
            const surface = publisher.update(values({ 'window-bg-color': '#f3e6f5' }))!;
            expect(surface.includes('.adw-switch {')).toBe(false);
            const accented = publisher.update(values({ 'window-bg-color': '#f3e6f5', 'accent-bg-color': '#9141ac' }))!;
            expect(accented.includes('.adw-switch { background-color: #9141ac; }')).toBe(true);
            const undone = publisher.update(values({ 'window-bg-color': '#f3e6f5' }))!;
            expect(undone.includes('.adw-switch {')).toBe(true);
        });
    });
};
