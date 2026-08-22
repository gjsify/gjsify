// DOM-level tests for <adw-icon>, driven by the SAME `normalizeIconName` vectors the
// core suite asserts against (`@gjsify/adwaita-core/conformance`).
//
// The icon-name class must never be built by hand: a name is only usable once it is
// known to be a SINGLE CSS token, and hand-built spans skipped that check, so
// `icon-name="a b"` interpolated a stray second class and shipped it through
// `<adw-menu-button>` for its own icon and for every JSON menu entry's. The vectors run
// against the ELEMENT, so hand-building the class again fails naming the input.
import { describe, expect, it } from '@gjsify/unit';

import { VIEW_STACK_ICON_NAME_VECTORS } from '@gjsify/adwaita-core/conformance';

import type { AdwIcon } from './elements/adw-icon.js';
import type { AdwMenuButton } from './elements/adw-menu-button.js';

function mount<T extends HTMLElement>(tag: string): { el: T; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement(tag) as T;
    host.appendChild(el);
    return { el, host };
}

/** Every class on the node that is not the base `.adw-icon`. */
function extraClasses(el: HTMLElement): string[] {
    return [...el.classList].filter((c) => c !== 'adw-icon').sort();
}

export const AdwIconTest = async () => {
    await describe('<adw-icon> mask class (normalizeIconName vectors)', async () => {
        for (const { icon, normalized, rule } of VIEW_STACK_ICON_NAME_VECTORS) {
            await it(`${JSON.stringify(icon)} → ${JSON.stringify(normalized)} — ${rule}`, () => {
                const { el, host } = mount<AdwIcon>('adw-icon');
                el.iconName = icon ?? null;

                expect(el.resolvedIconName).toBe(normalized);
                // The base class is unconditional: a nameless icon is still an icon box,
                // which `<adw-status-page>` hides rather than omits.
                expect(el.classList.contains('adw-icon')).toBe(true);
                // …and EXACTLY ONE mask class is on it — the assertion a hand-rolled copy
                // cannot make, where `icon-name="a b"` left a stray `b`. A name that was
                // GIVEN but is unusable falls back to the glyph GTK falls back to, so only
                // an absent or empty name leaves the node classless.
                // Spelled out rather than reusing the impl's own predicate, so the
                // expectation cannot agree with a wrong implementation.
                let drawn = normalized;
                if (drawn === '' && (icon ?? '') !== '') drawn = 'image-missing';
                expect(extraClasses(el)).toStrictEqual(drawn === '' ? [] : [`adw-icon--${drawn}`]);
                host.remove();
            });
        }
    });

    await describe('<adw-icon> node contract', async () => {
        await it('is decorative — the accessible name belongs to the host control', () => {
            const { el, host } = mount<AdwIcon>('adw-icon');
            expect(el.getAttribute('aria-hidden')).toBe('true');
            host.remove();
        });

        await it('swaps ONLY the mask class, keeping the caller position classes', () => {
            const { el, host } = mount<AdwIcon>('adw-icon');
            el.classList.add('adw-drop-down-arrow', 'start');
            el.iconName = 'go-down';
            expect(extraClasses(el)).toStrictEqual(['adw-drop-down-arrow', 'adw-icon--go-down', 'start']);

            el.iconName = 'go-next';
            // Exactly one mask class at a time, and the caller's are untouched: a
            // `className =` assignment would take them with it.
            expect(extraClasses(el)).toStrictEqual(['adw-drop-down-arrow', 'adw-icon--go-next', 'start']);

            el.iconName = null;
            expect(extraClasses(el)).toStrictEqual(['adw-drop-down-arrow', 'start']);
            host.remove();
        });

        await it('sizes the box AND the mask together', () => {
            const { el, host } = mount<AdwIcon>('adw-icon');
            el.iconName = 'go-next';
            // Unset: the stylesheet's 16px.
            expect(el.size).toBe(null);
            expect(getComputedStyle(el).width).toBe('16px');

            el.size = 32;
            const styled = getComputedStyle(el);
            expect(styled.width).toBe('32px');
            expect(styled.height).toBe('32px');
            // Sizing only the box leaves a 16px glyph floating in it. Only the axis set is
            // asserted: `mask-size: 32px` means "32px wide, height from the aspect ratio",
            // and the CSSOM re-serializes the omitted half (Firefox reports `32px auto`).
            expect(styled.maskSize.split(' ')[0]).toBe('32px');
            expect(styled.webkitMaskSize.split(' ')[0]).toBe('32px');

            el.size = null;
            expect(getComputedStyle(el).width).toBe('16px');
            host.remove();
        });

        await it('paints in the INHERITED colour, not the boundary reset colour', () => {
            // `.adw-icon` masks with `currentColor` and <adw-icon> is a custom element, so
            // the ADR-0010 `$adw-components` reset re-roots `color` on it: without
            // `color: inherit` in `_icon.scss` every icon repaints in `--window-fg-color`
            // regardless of the button it sits in.
            const { el: box, host } = mount<HTMLElement>('div');
            box.style.color = 'rgb(255, 0, 0)';
            const icon = document.createElement('adw-icon') as AdwIcon;
            icon.iconName = 'go-next';
            box.appendChild(icon);
            expect(getComputedStyle(icon).backgroundColor).toBe('rgb(255, 0, 0)');
            host.remove();
        });
    });

    await describe('the hand-rolled copies are gone', async () => {
        await it('<adw-menu-button> no longer injects a stray class from its icon-name', () => {
            const { el, host } = mount<AdwMenuButton>('adw-menu-button');
            el.setAttribute('icon-name', 'a b');
            const icon = el.querySelector('.adw-icon') as HTMLElement;
            // `adw-icon--a b` would have added a second, unrelated `b` class. What it gets
            // instead is the ONE fallback class, not two tokens and not none.
            expect(extraClasses(icon)).toStrictEqual(['adw-icon--image-missing', 'adw-menu-button-icon']);
            host.remove();
        });

        await it('<adw-menu-button> menu entries guard their icons too', () => {
            const { el, host } = mount<AdwMenuButton>('adw-menu-button');
            el.menuItems = [
                { label: 'Bad', icon: 'a b' },
                { label: 'Good', icon: 'view-refresh-symbolic' },
                { label: 'None' },
            ];
            const items = [...el.querySelectorAll('.adw-menu-button-item')];
            expect(items.length).toBe(3);
            // An entry that ASKED for an icon keeps its slot even when the name is
            // unusable — it shows the broken glyph, which is what tells the author the
            // name is wrong. Only an entry with no `icon` key gets no node at all.
            const bad = items[0].querySelector('.adw-icon') as HTMLElement;
            expect(extraClasses(bad)).toStrictEqual(['adw-icon--image-missing', 'adw-menu-button-item-icon']);
            expect(items[2].querySelector('.adw-icon')).toBe(null);
            const good = items[1].querySelector('.adw-icon') as HTMLElement;
            expect(extraClasses(good)).toStrictEqual(['adw-icon--view-refresh', 'adw-menu-button-item-icon']);
            host.remove();
        });

        await it('every icon in the package is an <adw-icon>', () => {
            // Asserted structurally: a page of every icon-drawing widget, and no bare span
            // carrying the base class — so a new hand-rolled `<span class="adw-icon …">`
            // fails here even when it guards its own name correctly.
            const { el: page, host } = mount<HTMLElement>('div');
            page.innerHTML = `
                <adw-button icon="go-next" label="Next"></adw-button>
                <adw-button-row title="Row" start-icon-name="list-add" end-icon-name="go-next"></adw-button-row>
                <adw-status-page icon="folder" title="Empty"></adw-status-page>
                <adw-split-button label="Save" menu='[{"label":"Save As"}]'></adw-split-button>
                <adw-drop-down options='["a","b"]'></adw-drop-down>
                <adw-expander-row title="More" show-enable-switch></adw-expander-row>
                <adw-avatar text="Ada" icon="avatar-default"></adw-avatar>
                <adw-toggle-group><adw-toggle icon-name="view-list"></adw-toggle></adw-toggle-group>
            `;
            const bareSpans = [...host.querySelectorAll('span.adw-icon')];
            expect(bareSpans.length).toBe(0);
            // …and the icons really are there, so the check is not vacuous.
            expect(host.querySelectorAll('adw-icon.adw-icon').length > 5).toBe(true);
            host.remove();
        });
    });
};
