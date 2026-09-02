// Button-content derivation specs — driven by the shared conformance vectors,
// so this suite and the two renderer suites assert the SAME table.

import { describe, expect, it } from '@gjsify/unit';

import {
    ADW_BUTTON_CONTENT_DEFAULTS,
    BUTTON_CONTENT_BOX_SPACING,
    BUTTON_CONTENT_FALLBACK_ICON,
    BUTTON_CONTENT_STYLE_CLASS,
    buttonContentEllipsize,
    buttonContentIconExpands,
    buttonContentIconIsEmpty,
    buttonContentIconName,
    buttonContentLabelText,
    buttonContentLabelVisible,
    buttonContentRenderState,
    buttonContentStyleTargetIndex,
} from './button-content.js';
import {
    BUTTON_CONTENT_DEFAULT_VECTORS,
    BUTTON_CONTENT_ELLIPSIZE_VECTORS,
    BUTTON_CONTENT_ICON_VECTORS,
    BUTTON_CONTENT_LABEL_VECTORS,
    BUTTON_CONTENT_STYLE_TARGET_VECTORS,
    BUTTON_CONTENT_TEXT_VECTORS,
} from './conformance/button-content.js';

/** The defaults, keyed the way GObject spells the properties. */
const DEFAULT_BY_PROPERTY: Record<string, string | boolean> = {
    'icon-name': ADW_BUTTON_CONTENT_DEFAULTS.iconName,
    label: ADW_BUTTON_CONTENT_DEFAULTS.label,
    'use-underline': ADW_BUTTON_CONTENT_DEFAULTS.useUnderline,
    'can-shrink': ADW_BUTTON_CONTENT_DEFAULTS.canShrink,
};

export default async () => {
    await describe('ADW_BUTTON_CONTENT_DEFAULTS (the GParamSpec defaults)', async () => {
        for (const { property, value, rule } of BUTTON_CONTENT_DEFAULT_VECTORS) {
            await it(`${property} → ${JSON.stringify(value)} — ${rule}`, () => {
                expect(DEFAULT_BY_PROPERTY[property]).toBe(value);
            });
        }
    });

    await describe('BUTTON_CONTENT_BOX_SPACING (measured, not read off a selector)', async () => {
        await it('is the 6px the widget actually draws, not GtkBox:spacing', () => {
            // Against libadwaita 1.9.3, an AdwButtonContent with an icon and a label
            // inside a presented GtkButton: image at x=161 width=16, label at x=183.
            // The same widget's `GtkBox:spacing` reads 0, so a renderer that copied the
            // PROPERTY would draw the two touching — which is why the number is here and
            // not derived by a renderer from the box it can see.
            expect(BUTTON_CONTENT_BOX_SPACING).toBe(6);
        });
    });

    await describe('buttonContentIconName (:355-358 — code, not the :228/:343 docs)', async () => {
        for (const { iconName, resolved, isFallback, rule } of BUTTON_CONTENT_ICON_VECTORS) {
            await it(`${JSON.stringify(iconName)} → ${JSON.stringify(resolved)} — ${rule}`, () => {
                expect(buttonContentIconName(iconName)).toBe(resolved);
                expect(buttonContentIconIsEmpty(iconName)).toBe(isFallback);
            });
        }

        await it('names the fallback the C names', () => {
            expect(BUTTON_CONTENT_FALLBACK_ICON).toBe('image-missing');
        });
    });

    await describe('buttonContentLabelVisible / IconExpands (:398-399)', async () => {
        for (const { label, visible, iconExpands, rule } of BUTTON_CONTENT_LABEL_VECTORS) {
            await it(`${JSON.stringify(label)} → visible ${visible}, iconExpands ${iconExpands} — ${rule}`, () => {
                expect(buttonContentLabelVisible(label)).toBe(visible);
                expect(buttonContentIconExpands(label)).toBe(iconExpands);
            });
        }
    });

    await describe('buttonContentLabelText (use-underline, :442)', async () => {
        for (const { label, useUnderline, text, rule } of BUTTON_CONTENT_TEXT_VECTORS) {
            const name = `${JSON.stringify(label)} + use-underline ${useUnderline} → ${JSON.stringify(text)}`;
            await it(`${name} — ${rule}`, () => {
                expect(buttonContentLabelText(label, useUnderline)).toBe(text);
            });
        }
    });

    await describe('buttonContentEllipsize (can-shrink, :489-491)', async () => {
        for (const { canShrink, ellipsize, rule } of BUTTON_CONTENT_ELLIPSIZE_VECTORS) {
            await it(`${canShrink} → ${ellipsize} — ${rule}`, () => {
                expect(buttonContentEllipsize(canShrink)).toBe(ellipsize);
            });
        }
    });

    await describe('buttonContentStyleTargetIndex (adw_button_content_root, :108-116)', async () => {
        for (const { ancestors, target, rule } of BUTTON_CONTENT_STYLE_TARGET_VECTORS) {
            await it(`[${ancestors.join(' > ')}] → ${target} — ${rule}`, () => {
                expect(buttonContentStyleTargetIndex(ancestors)).toBe(target);
            });
        }

        await it('names the class the C adds and removes', () => {
            expect(BUTTON_CONTENT_STYLE_CLASS).toBe('image-text-button');
        });
    });

    await describe('buttonContentRenderState (defaults fill every unset property)', async () => {
        await it('an unconfigured content shows the fallback icon and no label', () => {
            expect(buttonContentRenderState()).toStrictEqual({
                iconName: 'image-missing',
                iconIsFallback: true,
                iconExpands: true,
                labelVisible: false,
                labelText: '',
                ellipsize: 'none',
                parentClass: 'image-text-button',
            });
        });

        await it('a configured content resolves every derivation at once', () => {
            expect(
                buttonContentRenderState({
                    iconName: 'folder-download-symbolic',
                    label: '_Download',
                    useUnderline: true,
                    canShrink: true,
                }),
            ).toStrictEqual({
                iconName: 'folder-download-symbolic',
                iconIsFallback: false,
                iconExpands: false,
                labelVisible: true,
                labelText: 'Download',
                ellipsize: 'end',
                parentClass: 'image-text-button',
            });
        });
    });
};
