// DOM-level conformance tests for <adw-button-content>, driven by the SAME
// vectors the NativeScript renderer asserts against
// (`@gjsify/adwaita-core/conformance`).
//
// THE STYLE CLASS IS WHY THIS SUITE EXISTS. `AdwButtonContent` puts
// `image-text-button` on the button hosting it (adw-button-content.c:115) and
// removes it on unroot (:126); the stylesheet gives that class
// `padding-left/right: 9px` where a plain text button has 17px
// (_buttons.scss:77-80 against :72-75). `grep -rn "image-text-button"` over both
// renderer trees returned NOTHING, so every icon+label button in this package
// was drawn with the wrong horizontal padding for its whole life. `use-underline`
// was absent, and an empty `icon-name` hid the image where the C sets
// `image-missing` (:355-356).
import { describe, expect, it } from '@gjsify/unit';

import { BUTTON_CONTENT_STYLE_CLASS, normalizeIconName } from '@gjsify/adwaita-core';
import {
    BUTTON_CONTENT_ELLIPSIZE_VECTORS,
    BUTTON_CONTENT_ICON_VECTORS,
    BUTTON_CONTENT_LABEL_VECTORS,
    BUTTON_CONTENT_TEXT_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import type { AdwButtonContent } from './elements/adw-button-content.js';

/** Mount a button content inside a plain Adwaita button, the way the stories do. */
function mount(attributes: Record<string, string> = {}): {
    el: AdwButtonContent;
    button: HTMLButtonElement;
    host: HTMLElement;
} {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const button = document.createElement('button');
    button.className = 'adw-button';
    const el = document.createElement('adw-button-content') as AdwButtonContent;
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    button.appendChild(el);
    host.appendChild(button);
    return { el, button, host };
}

const iconEl = (el: AdwButtonContent): HTMLElement => el.querySelector('[aria-hidden="true"]') as HTMLElement;
const labelEl = (el: AdwButtonContent): HTMLElement => el.querySelector('.adw-button-content-label') as HTMLElement;

export const AdwButtonContentTest = async () => {
    await describe('adw-button-content parent style class (adw_button_content_root, :115)', async () => {
        await it('stamps image-text-button on the button hosting it', () => {
            const { button, host } = mount({ 'icon-name': 'folder-download', label: 'Download' });
            expect(button.classList.contains(BUTTON_CONTENT_STYLE_CLASS)).toBe(true);
            host.remove();
        });

        await it('gives that button the 9px padding the class carries (_buttons.scss:77-80)', () => {
            const { button, host } = mount({ 'icon-name': 'folder-download', label: 'Download' });
            const style = getComputedStyle(button);
            expect(style.paddingLeft).toBe('9px');
            expect(style.paddingRight).toBe('9px');
            host.remove();
        });

        await it('a plain Adwaita button without a content keeps its own padding', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const button = document.createElement('button');
            button.className = 'adw-button';
            button.textContent = 'Download';
            host.appendChild(button);
            expect(button.classList.contains(BUTTON_CONTENT_STYLE_CLASS)).toBe(false);
            expect(getComputedStyle(button).paddingLeft === '9px').toBe(false);
            host.remove();
        });

        await it('takes the class off again when the content leaves (:126)', () => {
            const { el, button, host } = mount({ 'icon-name': 'folder-download', label: 'Download' });
            el.remove();
            expect(button.classList.contains(BUTTON_CONTENT_STYLE_CLASS)).toBe(false);
            host.remove();
        });

        await it('retargets to the split button when the button sits inside one (:112-113)', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const split = document.createElement('div');
            split.className = 'adw-split-button';
            const action = document.createElement('button');
            action.className = 'adw-split-button-action';
            const el = document.createElement('adw-button-content') as AdwButtonContent;
            el.setAttribute('label', 'Save');
            action.appendChild(el);
            split.appendChild(action);
            host.appendChild(split);

            // The class goes on the `splitbutton` node, which is what
            // `splitbutton.image-text-button > button` (:499-507) selects —
            // a different declaration block from the plain-button one.
            expect(split.classList.contains(BUTTON_CONTENT_STYLE_CLASS)).toBe(true);
            expect(action.classList.contains(BUTTON_CONTENT_STYLE_CLASS)).toBe(false);
            // …and the padding lands on the INNER button, which is what that
            // block declares — not on the node carrying the class.
            expect(getComputedStyle(action).paddingLeft).toBe('9px');
            host.remove();
        });

        await it('styles nothing when there is no button ancestor', () => {
            const host = document.createElement('div');
            document.body.appendChild(host);
            const el = document.createElement('adw-button-content') as AdwButtonContent;
            el.setAttribute('label', 'Save');
            host.appendChild(el);
            expect(host.classList.contains(BUTTON_CONTENT_STYLE_CLASS)).toBe(false);
            host.remove();
        });
    });

    await describe('adw-button-content icon slot (libadwaita conformance vectors)', async () => {
        for (const { iconName, resolved, rule } of BUTTON_CONTENT_ICON_VECTORS) {
            await it(`${JSON.stringify(iconName)} → ${JSON.stringify(resolved)} — ${rule}`, () => {
                const { el, host } = mount({ 'icon-name': iconName, label: 'Download' });
                const icon = iconEl(el);
                // The core resolution (`resolved`) is the NAME; the mask class is
                // this package's convention on top of it, and the two differ —
                // the generated classes never carry `-symbolic`. This element used
                // to interpolate the raw name, so `icon-name="folder-download-symbolic"`
                // asked for `.adw-icon--folder-download-symbolic`, a class that has
                // never existed, and drew an empty 16px box. `<adw-icon>` applies
                // `normalizeIconName`, which also makes the `' '` row assertable
                // instead of skipped: a space is not one CSS token, so it draws
                // nothing rather than injecting a second class.
                const maskName = normalizeIconName(resolved);
                expect(icon.classList.contains(`adw-icon--${maskName}`)).toBe(maskName !== '');
                expect([...icon.classList].filter((c) => c.startsWith('adw-icon--')).length).toBe(
                    maskName === '' ? 0 : 1,
                );
                // The image node is never hidden — `gtk_widget_set_visible` is
                // called on the LABEL only (:300, :398).
                expect(icon.hidden).toBe(false);
                host.remove();
            });
        }

        await it('an absent icon-name attribute is the empty case, so the image still shows', () => {
            const { el, host } = mount({ label: 'Download' });
            expect(iconEl(el).hidden).toBe(false);
            expect(iconEl(el).classList.contains('adw-icon--image-missing')).toBe(true);
            host.remove();
        });
    });

    await describe('adw-button-content label slot (libadwaita conformance vectors)', async () => {
        for (const { label, visible, rule } of BUTTON_CONTENT_LABEL_VECTORS) {
            await it(`${JSON.stringify(label)} → visible ${visible} — ${rule}`, () => {
                const { el, host } = mount({ 'icon-name': 'folder-download', label });
                expect(labelEl(el).hidden).toBe(!visible);
                host.remove();
            });
        }
    });

    await describe('adw-button-content use-underline (libadwaita conformance vectors)', async () => {
        for (const { label, useUnderline, text, rule } of BUTTON_CONTENT_TEXT_VECTORS) {
            await it(`${JSON.stringify(label)} + ${useUnderline} → ${JSON.stringify(text)} — ${rule}`, () => {
                const attributes: Record<string, string> = { 'icon-name': 'folder-download', label };
                if (useUnderline) attributes['use-underline'] = '';
                const { el, host } = mount(attributes);
                expect(labelEl(el).textContent).toBe(text);
                host.remove();
            });
        }
    });

    await describe('adw-button-content can-shrink (libadwaita conformance vectors)', async () => {
        for (const { canShrink, ellipsize, rule } of BUTTON_CONTENT_ELLIPSIZE_VECTORS) {
            await it(`${canShrink} → ${ellipsize} — ${rule}`, () => {
                const attributes: Record<string, string> = { 'icon-name': 'folder-download', label: 'Download' };
                if (canShrink) attributes['can-shrink'] = '';
                const { el, host } = mount(attributes);
                expect(el.classList.contains('can-shrink')).toBe(canShrink);
                expect(getComputedStyle(labelEl(el)).textOverflow).toBe(canShrink ? 'ellipsis' : 'clip');
                host.remove();
            });
        }
    });
};
