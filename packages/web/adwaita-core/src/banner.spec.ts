// Banner derivation specs — driven by the shared conformance vectors, so this
// suite and the two renderer suites assert the SAME table.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_BANNER_BUTTON_STYLES,
    ADW_BANNER_BUTTON_STYLE_CLASSES,
    ADW_BANNER_DEFAULTS,
    bannerButtonStyleClasses,
    bannerButtonText,
    bannerButtonVisible,
    bannerRenderState,
    isBannerButtonStyle,
    parseBannerButtonStyle,
} from './banner.js';
import {
    BANNER_BUTTON_STYLE_PARSE_VECTORS,
    BANNER_BUTTON_STYLE_VECTORS,
    BANNER_BUTTON_TEXT_VECTORS,
    BANNER_BUTTON_VISIBLE_VECTORS,
    BANNER_DEFAULT_VECTORS,
} from './conformance/banner.js';

/** The defaults, keyed the way GObject spells the properties. */
const DEFAULT_BY_PROPERTY: Record<string, string | boolean> = {
    title: ADW_BANNER_DEFAULTS.title,
    'button-label': ADW_BANNER_DEFAULTS.buttonLabel,
    revealed: ADW_BANNER_DEFAULTS.revealed,
    'use-markup': ADW_BANNER_DEFAULTS.useMarkup,
    'button-style': ADW_BANNER_DEFAULTS.buttonStyle,
};

export default async () => {
    await describe('ADW_BANNER_DEFAULTS (the GParamSpec defaults)', async () => {
        for (const { property, value, rule } of BANNER_DEFAULT_VECTORS) {
            await it(`${property} → ${JSON.stringify(value)} — ${rule}`, () => {
                expect(DEFAULT_BY_PROPERTY[property]).toBe(value);
            });
        }
    });

    await describe('bannerButtonVisible (label && label[0], :663)', async () => {
        for (const { label, visible, rule } of BANNER_BUTTON_VISIBLE_VECTORS) {
            await it(`${JSON.stringify(label)} → ${visible} — ${rule}`, () => {
                expect(bannerButtonVisible(label)).toBe(visible);
            });
        }

        await it('treats undefined like NULL', () => {
            expect(bannerButtonVisible(undefined)).toBe(false);
        });
    });

    await describe('bannerButtonText (the template pins use-underline, adw-banner.ui:33)', async () => {
        for (const { label, text, rule } of BANNER_BUTTON_TEXT_VECTORS) {
            await it(`${JSON.stringify(label)} → ${JSON.stringify(text)} — ${rule}`, () => {
                expect(bannerButtonText(label)).toBe(text);
            });
        }
    });

    await describe('bannerButtonStyleClasses (:764-774)', async () => {
        for (const { style, classes, rule } of BANNER_BUTTON_STYLE_VECTORS) {
            await it(`${style} → [${classes.join(', ')}] — ${rule}`, () => {
                expect(bannerButtonStyleClasses(style)).toStrictEqual(classes);
            });
        }

        await it('manages exactly the one class the C adds and removes', () => {
            expect(ADW_BANNER_BUTTON_STYLE_CLASSES).toStrictEqual(['suggested-action']);
        });

        await it('exposes both enum members, in enum order', () => {
            expect(ADW_BANNER_BUTTON_STYLES).toStrictEqual(['default', 'suggested']);
        });
    });

    await describe('parseBannerButtonStyle (renderer string → enum)', async () => {
        for (const { input, style, rule } of BANNER_BUTTON_STYLE_PARSE_VECTORS) {
            await it(`${JSON.stringify(input)} → ${style} — ${rule}`, () => {
                expect(parseBannerButtonStyle(input)).toBe(style);
            });
        }

        await it('guards both nicks and nothing else', () => {
            expect(isBannerButtonStyle('default')).toBe(true);
            expect(isBannerButtonStyle('suggested')).toBe(true);
            expect(isBannerButtonStyle('Suggested')).toBe(false);
            expect(isBannerButtonStyle(0)).toBe(false);
        });
    });

    await describe('bannerRenderState (defaults fill every unset property)', async () => {
        await it('an unconfigured banner is hidden, markup-enabled and button-less', () => {
            expect(bannerRenderState()).toStrictEqual({
                revealed: false,
                useMarkup: true,
                buttonVisible: false,
                buttonText: '',
                buttonClasses: [],
            });
        });

        await it('a suggested banner with a mnemonic button resolves all three derivations', () => {
            expect(bannerRenderState({ buttonLabel: '_Resume', buttonStyle: 'suggested', revealed: true })).toStrictEqual(
                {
                    revealed: true,
                    useMarkup: true,
                    buttonVisible: true,
                    buttonText: 'Resume',
                    buttonClasses: ['suggested-action'],
                },
            );
        });

        await it('an explicitly disabled use-markup survives the default merge', () => {
            expect(bannerRenderState({ useMarkup: false }).useMarkup).toBe(false);
        });
    });
};
