// AdwButtonContent conformance tests, driven by the SAME vectors the browser
// renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// The regression this suite exists for: `grep -rn "image-text-button"` over both
// renderer trees returned NOTHING. `adw_button_content_root` puts that class on
// the parent button (adw-button-content.c:115) and the stylesheet gives it
// `padding-left/right: 9px` (_buttons.scss:77-80) where a plain text button has
// 17px (:72-75) — so every icon+label button in this port was drawn with the
// wrong horizontal padding. `use-underline` and `can-shrink` were missing too,
// the label view was parented whether or not it had any text, and an empty icon
// hid the image where the C shows `image-missing`.
//
// IMPORTANT: this file must NOT import `./widgets/adw-button-content.js` (nor
// the package root). That module `extends StackLayout`, which evaluates the bare
// `@nativescript/core` specifier at module-eval and is unresolvable on GJS/Node.
// The behaviour is exercised through `./widgets/button-content.js`, the pure
// sibling the widget composes.

import { describe, expect, it } from '@gjsify/unit';

import { buttonContentStyleTargetIndex } from '@gjsify/adwaita-core';
import {
    BUTTON_CONTENT_ELLIPSIZE_VECTORS,
    BUTTON_CONTENT_ICON_VECTORS,
    BUTTON_CONTENT_LABEL_VECTORS,
    BUTTON_CONTENT_STYLE_TARGET_VECTORS,
    BUTTON_CONTENT_TEXT_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import { imageMissingSymbolic } from '@gjsify/adwaita-icons/status';
import {
    BUTTON_CONTENT_STYLE_CLASS,
    buttonContentClassName,
    buttonContentEllipsize,
    buttonContentIconIsFallback,
    buttonContentIconSvg,
    buttonContentLabelText,
    buttonContentLabelVisibility,
    buttonContentRootedParentClassName,
    buttonContentUnrootedParentClassName,
} from './widgets/button-content.js';

/** A stand-in SVG — the NS port is handed icon SOURCE, not an icon-theme name. */
const SVG = '<svg viewBox="0 0 16 16"></svg>';

export default async () => {
    await describe('AdwButtonContent parent style class (adw_button_content_root, :115)', async () => {
        await it('stamps image-text-button on the button hosting the content', () => {
            expect(buttonContentRootedParentClassName('adw-button').split(' ')).toStrictEqual([
                'adw-button',
                'image-text-button',
            ]);
        });

        await it('keeps every class a consumer put on the button', () => {
            expect(buttonContentRootedParentClassName('adw-button suggested-action pill').split(' ')).toStrictEqual([
                'adw-button',
                'suggested-action',
                'pill',
                'image-text-button',
            ]);
        });

        await it('is idempotent — re-hosting does not double the token', () => {
            const once = buttonContentRootedParentClassName('adw-button');
            expect(buttonContentRootedParentClassName(once)).toBe(once);
        });

        await it('takes the class off again on unroot (:126), so padding reverts', () => {
            const rooted = buttonContentRootedParentClassName('adw-button pill');
            expect(buttonContentUnrootedParentClassName(rooted).split(' ')).toStrictEqual(['adw-button', 'pill']);
        });

        await it('names the class the stylesheet keys the 9px padding off', () => {
            expect(BUTTON_CONTENT_STYLE_CLASS).toBe('image-text-button');
        });

        // Which ancestor gets the class is renderer-independent, so the RULE is
        // asserted against core here too: this port has no rooting protocol and
        // is told its host explicitly, but it must not disagree with the C about
        // WHICH view that is when it grows one.
        for (const { ancestors, target, rule } of BUTTON_CONTENT_STYLE_TARGET_VECTORS) {
            await it(`[${ancestors.join(' > ')}] → ${target} — ${rule}`, () => {
                expect(buttonContentStyleTargetIndex(ancestors)).toBe(target);
            });
        }
    });

    await describe('AdwButtonContent icon slot (shared conformance vectors)', async () => {
        for (const { iconName, isFallback, rule } of BUTTON_CONTENT_ICON_VECTORS) {
            // This port holds SVG SOURCE rather than an icon-theme name, so the
            // representation-free half of the vector is what applies: an empty
            // slot draws the fallback ASSET, a non-empty one draws what it was
            // given. The icon view is never hidden either way.
            const svg = iconName === '' ? '' : SVG;
            await it(`${JSON.stringify(iconName)} → fallback ${isFallback} — ${rule}`, () => {
                expect(buttonContentIconIsFallback(svg)).toBe(isFallback);
                expect(buttonContentIconSvg(svg)).toBe(isFallback ? imageMissingSymbolic : SVG);
            });
        }

        await it('resolves the empty slot to the real image-missing asset', () => {
            expect(buttonContentIconSvg('').length > 0).toBe(true);
        });
    });

    await describe('AdwButtonContent label slot (shared conformance vectors)', async () => {
        for (const { label, visible, rule } of BUTTON_CONTENT_LABEL_VECTORS) {
            await it(`${JSON.stringify(label)} → visibility ${visible ? 'visible' : 'collapse'} — ${rule}`, () => {
                expect(buttonContentLabelVisibility(label)).toBe(visible ? 'visible' : 'collapse');
            });
        }
    });

    await describe('AdwButtonContent use-underline (shared conformance vectors)', async () => {
        for (const { label, useUnderline, text, rule } of BUTTON_CONTENT_TEXT_VECTORS) {
            await it(`${JSON.stringify(label)} + ${useUnderline} → ${JSON.stringify(text)} — ${rule}`, () => {
                expect(buttonContentLabelText(label, useUnderline)).toBe(text);
            });
        }
    });

    await describe('AdwButtonContent can-shrink (shared conformance vectors)', async () => {
        for (const { canShrink, ellipsize, rule } of BUTTON_CONTENT_ELLIPSIZE_VECTORS) {
            await it(`${canShrink} → ${ellipsize} — ${rule}`, () => {
                expect(buttonContentEllipsize(canShrink)).toBe(ellipsize);
                expect(buttonContentClassName('adw-button-content', canShrink).split(' ')).toStrictEqual(
                    canShrink ? ['adw-button-content', 'can-shrink'] : ['adw-button-content'],
                );
            });
        }
    });
};
