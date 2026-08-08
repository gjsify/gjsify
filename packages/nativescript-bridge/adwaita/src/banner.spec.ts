// AdwBanner conformance tests, driven by the SAME vectors the browser renderer
// asserts against (`@gjsify/adwaita-core/conformance`).
//
// The regression this suite exists for: `AdwBanner` initialised `_revealed =
// true` and its constructor never wrote `visibility`, so a banner showed itself
// on a device while the same markup stayed hidden in the browser — where
// `revealed` was correctly opt-in. libadwaita agrees with the browser
// (adw-banner.c:456-459, "Banners are hidden by default", :47). Neither port had
// `button-style` at all, and neither stripped the mnemonic marker the template
// puts on the button (adw-banner.ui:33).
//
// IMPORTANT: this file must NOT import `./widgets/adw-banner.js` (nor the
// package root). That module `extends GridLayout`, which evaluates the bare
// `@nativescript/core` specifier at module-eval and is unresolvable on GJS/Node.
// The behaviour is exercised through `./widgets/chrome.js`, the pure sibling the
// widget composes.

import { describe, expect, it } from '@gjsify/unit';

import { bannerButtonText, bannerButtonVisible, stripMarkup } from '@gjsify/adwaita-core';
import {
    BANNER_BUTTON_STYLE_VECTORS,
    BANNER_BUTTON_TEXT_VECTORS,
    BANNER_BUTTON_VISIBLE_VECTORS,
    BANNER_DEFAULT_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import { bannerButtonClassName, bannerTitleText, bannerVisibility, defaultBannerProps } from './widgets/chrome.js';

export default async () => {
    await describe('AdwBanner property defaults (shared conformance vectors)', async () => {
        for (const { property, value, rule } of BANNER_DEFAULT_VECTORS) {
            // `title` and `button-label` are plain NS view text; the three the
            // widget holds itself are the ones a default can be wrong about.
            if (property === 'title' || property === 'button-label') continue;
            await it(`${property} → ${JSON.stringify(value)} — ${rule}`, () => {
                const props = defaultBannerProps();
                const actual =
                    property === 'revealed'
                        ? props.revealed
                        : property === 'use-markup'
                          ? props.useMarkup
                          : props.buttonStyle;
                expect(actual).toBe(value);
            });
        }

        await it('starts COLLAPSED, so a fresh banner is not on screen', () => {
            expect(bannerVisibility(defaultBannerProps().revealed)).toBe('collapse');
        });

        await it('maps revealed → visible', () => {
            expect(bannerVisibility(true)).toBe('visible');
        });
    });

    await describe('AdwBanner button visibility (shared conformance vectors)', async () => {
        for (const { label, visible, rule } of BANNER_BUTTON_VISIBLE_VECTORS) {
            await it(`${JSON.stringify(label)} → ${visible} — ${rule}`, () => {
                expect(bannerButtonVisible(label)).toBe(visible);
            });
        }
    });

    await describe('AdwBanner button text (shared conformance vectors)', async () => {
        for (const { label, text, rule } of BANNER_BUTTON_TEXT_VECTORS) {
            await it(`${JSON.stringify(label)} → ${JSON.stringify(text)} — ${rule}`, () => {
                expect(bannerButtonText(label)).toBe(text);
            });
        }
    });

    await describe('AdwBanner button style class (shared conformance vectors)', async () => {
        for (const { style, classes, rule } of BANNER_BUTTON_STYLE_VECTORS) {
            await it(`${style} → [${classes.join(', ')}] — ${rule}`, () => {
                const className = bannerButtonClassName('adw-banner-button', style);
                expect(className.split(' ')).toStrictEqual(['adw-banner-button', ...classes]);
            });
        }

        await it('swaps only the managed class, keeping what a consumer added', () => {
            const suggested = bannerButtonClassName('adw-banner-button sb-custom', 'suggested');
            expect(suggested.split(' ')).toStrictEqual(['adw-banner-button', 'sb-custom', 'suggested-action']);
            expect(bannerButtonClassName(suggested, 'default').split(' ')).toStrictEqual([
                'adw-banner-button',
                'sb-custom',
            ]);
        });
    });

    await describe('AdwBanner title text (NS has no markup engine)', async () => {
        await it('reduces Pango markup to its plain text when use-markup is on', () => {
            expect(bannerTitleText('<b>Metered</b> connection', true)).toBe('Metered connection');
        });

        await it('keeps the raw string when markup is off — an angle bracket is text', () => {
            expect(bannerTitleText('<b>Metered</b> connection', false)).toBe('<b>Metered</b> connection');
        });

        await it('keeps the raw string when the markup does not parse (the C fallback)', () => {
            expect(stripMarkup('Tom & Jerry')).toBe(null);
            expect(bannerTitleText('Tom & Jerry', true)).toBe('Tom & Jerry');
        });
    });
};
