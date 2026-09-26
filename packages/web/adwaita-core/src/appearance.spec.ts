// The desktop-appearance handoff format (ADR 0078): the writer and the reader
// are asserted against EACH OTHER, since a format with two ends drifts at the
// seam between them.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_ACCENT_META,
    ADW_COLOR_SCHEME_META,
    appearanceFromMeta,
    parseDesktopAppearance,
    renderAppearanceMeta,
} from './appearance.js';
import { APPEARANCE_HANDOFF_VECTORS } from './conformance/appearance.js';

/** Read `<meta name=… content=…>` back out of rendered HTML — the page's side, without a DOM. */
function metaReader(html: string): (name: string) => string | null {
    return (name) => new RegExp(`<meta name="${name}" content="([^"]*)">`).exec(html)?.[1] ?? null;
}

export default async () => {
    await describe('parseDesktopAppearance', async () => {
        await it('keeps valid fields and normalises the colour', () => {
            expect(
                parseDesktopAppearance({ accent: 'purple', accentRgb: '#A550A7', colorScheme: 'dark' }),
            ).toStrictEqual({ accent: 'purple', accentRgb: '#a550a7', colorScheme: 'dark' });
        });

        await it('drops unknown or malformed fields instead of guessing a default', () => {
            // Absent means "not known", so a garbage accent must NOT become blue here —
            // blue is the page's own fallback, applied further down the precedence.
            expect(parseDesktopAppearance({ accent: 'magenta', accentRgb: 'nope', colorScheme: 1 })).toStrictEqual({});
            expect(parseDesktopAppearance(null)).toStrictEqual({});
            expect(parseDesktopAppearance('purple')).toStrictEqual({});
        });

        await it('keeps no-preference: it is an answer, not an absence', () => {
            expect(parseDesktopAppearance({ colorScheme: 'no-preference' })).toStrictEqual({
                colorScheme: 'no-preference',
            });
        });
    });

    await describe('APPEARANCE_HANDOFF_VECTORS (the writer)', async () => {
        for (const vector of APPEARANCE_HANDOFF_VECTORS) {
            await it(`${JSON.stringify(vector.appearance)} renders ${JSON.stringify(vector.meta)}`, () => {
                expect(renderAppearanceMeta(vector.appearance)).toBe(vector.meta);
            });
        }
    });

    await describe('renderAppearanceMeta ↔ appearanceFromMeta', async () => {
        await it('round-trips every field it renders', () => {
            const html = renderAppearanceMeta({ accent: 'teal', colorScheme: 'light', accentRgb: '#28bca3' });
            expect(html).toBe(
                `<meta name="${ADW_ACCENT_META}" content="teal">\n<meta name="${ADW_COLOR_SCHEME_META}" content="light">`,
            );
            expect(appearanceFromMeta(metaReader(html))).toStrictEqual({ accent: 'teal', colorScheme: 'light' });
        });

        await it('renders nothing for an unknown appearance, so the page falls through', () => {
            expect(renderAppearanceMeta({})).toBe('');
            expect(appearanceFromMeta(metaReader(''))).toStrictEqual({});
        });

        await it('never renders a value outside the closed sets', () => {
            // A caller passing an unchecked string must not be able to inject markup.
            const hostile = { accent: '"><script>', colorScheme: 'dark' } as unknown as Parameters<
                typeof renderAppearanceMeta
            >[0];
            expect(renderAppearanceMeta(hostile)).toBe(`<meta name="${ADW_COLOR_SCHEME_META}" content="dark">`);
        });

        await it('reads the system keyword and tolerates case and whitespace', () => {
            const read = (values: Record<string, string>) => (name: string) => values[name] ?? null;
            expect(appearanceFromMeta(read({ [ADW_ACCENT_META]: ' System ' }))).toStrictEqual({ accent: 'system' });
            expect(appearanceFromMeta(read({ [ADW_ACCENT_META]: 'PURPLE' }))).toStrictEqual({ accent: 'purple' });
            expect(appearanceFromMeta(read({ [ADW_ACCENT_META]: 'magenta' }))).toStrictEqual({});
        });
    });
};
