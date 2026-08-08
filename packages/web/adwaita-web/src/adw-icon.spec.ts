// DOM-level tests for <adw-icon>, driven by the SAME `normalizeIconName` vectors
// the core suite asserts against (`@gjsify/adwaita-core/conformance`), plus the
// REGRESSION PROOF for the drift the element was extracted to close.
//
// The drift: `<span class="adw-icon adw-icon--<name>" aria-hidden="true">` was
// built by hand at twenty-three sites across seventeen files, nine of them
// re-deriving `name.replace(/-symbolic$/, '')` on the spot. Exactly ONE site —
// `<adw-split-button>` — also checked the result was a single CSS token. So
// `icon-name="a b"` interpolated into `class="adw-icon adw-icon--a b"` and shipped
// a stray `b` class through `<adw-menu-button>`, for its own icon AND for every
// JSON menu entry's, while the one element that guarded kept passing its spec.
// The vectors below now run against the ELEMENT, so a renderer that starts
// building the class by hand again fails naming the input.
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
                // The base class is unconditional — a nameless icon is still an
                // icon box, which is what `<adw-status-page>` hides rather than
                // omits.
                expect(el.classList.contains('adw-icon')).toBe(true);
                // …and NOTHING else is on the node. This is the assertion the
                // hand-rolled copies could not make: `icon-name="a b"` used to
                // leave a stray `b` here.
                expect(extraClasses(el)).toStrictEqual(normalized === '' ? [] : [`adw-icon--${normalized}`]);
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
            // Exactly one mask class at a time, and the caller's are untouched —
            // a `className =` assignment would have taken them with it.
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
            // Sizing only the box would leave a 16px glyph floating in it. Only
            // the axis we set is asserted: `mask-size: 32px` means "32px wide,
            // height from the aspect ratio", and the CSSOM re-serializes the
            // omitted half (Firefox reports `32px auto`, in the inline style too).
            expect(styled.maskSize.split(' ')[0]).toBe('32px');
            expect(styled.webkitMaskSize.split(' ')[0]).toBe('32px');

            el.size = null;
            expect(getComputedStyle(el).width).toBe('16px');
            host.remove();
        });

        await it('paints in the INHERITED colour, not the boundary reset colour', () => {
            // `.adw-icon` masks with `currentColor`, and <adw-icon> is a custom
            // element — so the ADR-0010 `$adw-components` reset re-roots `color`
            // on it. Without `color: inherit` in `_icon.scss` every icon would
            // repaint in `--window-fg-color` regardless of the button it sits in.
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
            // `adw-icon--a b` would have added a second, unrelated `b` class.
            expect(extraClasses(icon)).toStrictEqual(['adw-menu-button-icon']);
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
            // An unusable name draws nothing rather than injecting markup, and
            // an entry with no icon still gets no icon node at all.
            expect(items[0].querySelector('.adw-icon')).toBe(null);
            expect(items[2].querySelector('.adw-icon')).toBe(null);
            const good = items[1].querySelector('.adw-icon') as HTMLElement;
            expect(extraClasses(good)).toStrictEqual(['adw-icon--view-refresh', 'adw-menu-button-item-icon']);
            host.remove();
        });

        await it('every icon in the package is an <adw-icon>', () => {
            // The point of the extraction, asserted structurally: build a page of
            // the widgets that draw icons and check no bare span carries the
            // base class. A new hand-rolled `<span class="adw-icon …">` fails
            // here even if it happens to guard its own name correctly.
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
