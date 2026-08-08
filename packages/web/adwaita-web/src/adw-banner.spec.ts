// DOM-level conformance tests for <adw-banner>, driven by the SAME vectors the
// NativeScript renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// The two renderers carried independent banner logic and had drifted apart AND
// away from libadwaita: `revealed` was opt-in here (right) and initialised TRUE
// on NativeScript with no `visibility` written at all (wrong), `use-markup` was
// opt-in in both with a comment here asserting that WAS the C default (it is
// TRUE, adw-banner.c:422-425), `button-style` was in neither, and the mnemonic
// marker the template pins onto the button (adw-banner.ui:33) was painted as a
// literal underscore. Nothing failed, because nothing compared them.
import { describe, expect, it } from '@gjsify/unit';

import { ADW_BANNER_DEFAULTS } from '@gjsify/adwaita-core';
import {
    BANNER_BUTTON_STYLE_PARSE_VECTORS,
    BANNER_BUTTON_STYLE_VECTORS,
    BANNER_BUTTON_TEXT_VECTORS,
    BANNER_BUTTON_VISIBLE_VECTORS,
    BANNER_DEFAULT_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import type { AdwBanner } from './elements/adw-banner.js';

/**
 * Mount a banner, setting attributes through `setAttribute` rather than parsed
 * HTML — several vectors hinge on exact whitespace (`button-label=" "`), which an
 * attribute value in markup is not a reliable carrier for.
 */
function mount(attributes: Record<string, string> = {}): { el: AdwBanner; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('adw-banner') as AdwBanner;
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

const titleEl = (el: AdwBanner): HTMLElement => el.querySelector('.adw-banner-title') as HTMLElement;
const buttonEl = (el: AdwBanner): HTMLButtonElement => el.querySelector('.adw-banner-button') as HTMLButtonElement;

export const AdwBannerTest = async () => {
    await describe('adw-banner defaults (libadwaita conformance vectors)', async () => {
        for (const { property, value, rule } of BANNER_DEFAULT_VECTORS) {
            if (property === 'use-markup') continue; // deliberate departure, asserted below
            await it(`${property} → ${JSON.stringify(value)} — ${rule}`, () => {
                const { el, host } = mount();
                const actual: Record<string, unknown> = {
                    title: titleEl(el).textContent,
                    'button-label': buttonEl(el).textContent,
                    revealed: el.classList.contains('revealed'),
                    'button-style': buttonEl(el).classList.contains('suggested-action') ? 'suggested' : 'default',
                };
                expect(actual[property]).toBe(value);
                host.remove();
            });
        }

        await it('an unrevealed banner is not laid out at all', () => {
            const { el, host } = mount({ title: 'Metered connection' });
            expect(getComputedStyle(el).display).toBe('none');
            el.setAttribute('revealed', '');
            expect(getComputedStyle(el).display === 'none').toBe(false);
            host.remove();
        });
    });

    await describe('adw-banner use-markup — a DELIBERATE departure from the C default', async () => {
        // The C default is unambiguously TRUE (adw-banner.c:422-425) and core
        // carries it as the spec value. This renderer does NOT adopt it: Pango
        // markup is not HTML, and defaulting a `title` attribute to `innerHTML`
        // would make an injection sink out of a widget that is not one in GTK.
        // The departure is pinned here so it stays a decision rather than
        // becoming a drift — and so does its cost.
        await it('core still reports the libadwaita default as TRUE', () => {
            expect(ADW_BANNER_DEFAULTS.useMarkup).toBe(true);
        });

        await it('the element defaults to TEXT — a title with tags shows them literally', () => {
            const { el, host } = mount({ title: '<b>Metered</b> connection', revealed: '' });
            expect(titleEl(el).textContent).toBe('<b>Metered</b> connection');
            expect(titleEl(el).querySelector('b')).toBe(null);
            host.remove();
        });

        await it('opting in renders markup, which is the developer asserting the title is trusted', () => {
            const { el, host } = mount({ title: '<b>Metered</b> connection', revealed: '', 'use-markup': '' });
            expect(titleEl(el).querySelector('b')?.textContent).toBe('Metered');
            host.remove();
        });
    });

    await describe('adw-banner button visibility (libadwaita conformance vectors)', async () => {
        for (const { label, visible, rule } of BANNER_BUTTON_VISIBLE_VECTORS) {
            if (label === null) continue; // an absent attribute, covered below
            await it(`${JSON.stringify(label)} → ${visible} — ${rule}`, () => {
                const { el, host } = mount({ revealed: '', 'button-label': label });
                expect(buttonEl(el).hidden).toBe(!visible);
                host.remove();
            });
        }

        await it('no button-label attribute is the NULL case — no button', () => {
            const { el, host } = mount({ revealed: '' });
            expect(buttonEl(el).hidden).toBe(true);
            host.remove();
        });
    });

    await describe('adw-banner button text (adw-banner.ui:33 pins use-underline)', async () => {
        for (const { label, text, rule } of BANNER_BUTTON_TEXT_VECTORS) {
            await it(`${JSON.stringify(label)} → ${JSON.stringify(text)} — ${rule}`, () => {
                const { el, host } = mount({ revealed: '', 'button-label': label });
                expect(buttonEl(el).textContent).toBe(text);
                host.remove();
            });
        }

        await it('the TITLE keeps its underscores — adw-banner.ui:20 pins it to use-underline=False', () => {
            const { el, host } = mount({ revealed: '', title: 'Snap_shot paused' });
            expect(titleEl(el).textContent).toBe('Snap_shot paused');
            host.remove();
        });
    });

    await describe('adw-banner button-style (libadwaita conformance vectors)', async () => {
        for (const { style, classes, rule } of BANNER_BUTTON_STYLE_VECTORS) {
            await it(`${style} → [${classes.join(', ')}] — ${rule}`, () => {
                const { el, host } = mount({ revealed: '', 'button-label': 'Resume', 'button-style': style });
                const button = buttonEl(el);
                expect(button.classList.contains('suggested-action')).toBe(classes.includes('suggested-action'));
                expect(button.classList.contains('adw-banner-button')).toBe(true);
                host.remove();
            });
        }

        for (const { input, style, rule } of BANNER_BUTTON_STYLE_PARSE_VECTORS) {
            if (input === null) continue; // an absent attribute, covered by the defaults block
            await it(`attribute ${JSON.stringify(input)} → ${style} — ${rule}`, () => {
                const { el, host } = mount({ revealed: '', 'button-label': 'Resume', 'button-style': input });
                expect(buttonEl(el).classList.contains('suggested-action')).toBe(style === 'suggested');
                host.remove();
            });
        }

        await it('switching back to default takes the class off again (:766)', () => {
            const { el, host } = mount({ revealed: '', 'button-label': 'Resume', 'button-style': 'suggested' });
            expect(buttonEl(el).classList.contains('suggested-action')).toBe(true);
            el.setAttribute('button-style', 'default');
            expect(buttonEl(el).classList.contains('suggested-action')).toBe(false);
            host.remove();
        });
    });
};
