// DOM-level conformance tests for <adw-split-button>, driven by the SAME vectors
// the NativeScript renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// The rules independent copies of the split-button logic drifted from: GTK clears
// whichever of label/icon it is not using, so both never render at once and the label
// must be clearable; a whitespace-only `label` is kept, not trimmed away; the dropdown's
// accessible name comes from `dropdown-tooltip`, with `DEFAULT_DROPDOWN_TOOLTIP` as the
// fallback and no hardcoded "Menu"; and no menu means no popover at all.
import { describe, expect, it } from '@gjsify/unit';

import { DEFAULT_DROPDOWN_TOOLTIP } from '@gjsify/adwaita-core';
import {
    POPOVER_SURFACE_VECTORS,
    SPLIT_BUTTON_CONTENT_VECTORS,
    SPLIT_BUTTON_DIRECTION_VECTORS,
    SPLIT_BUTTON_MENU_PARSE_VECTORS,
    SPLIT_BUTTON_STYLE_CLASS_VECTORS,
    SPLIT_BUTTON_TOOLTIP_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import type { SplitButtonProperty } from '@gjsify/adwaita-core';
import type { AdwSplitButton } from './elements/adw-split-button.js';
import { fallbackMask, maskOf } from './icon-registry.spec.js';

/** The GObject properties the element re-emits as `notify::*` CustomEvents. */
const NOTIFY_PROPERTIES: readonly SplitButtonProperty[] = [
    'label',
    'icon-name',
    'child',
    'use-underline',
    'menu-model',
    'popover',
    'direction',
    'dropdown-tooltip',
];

/**
 * Mount a split button, setting attributes through `setAttribute` rather than parsed
 * HTML: several vectors hinge on exact whitespace (`label="  "`), which markup is not a
 * reliable carrier for.
 */
function mount(attributes: Record<string, string> = {}): { el: AdwSplitButton; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('adw-split-button') as AdwSplitButton;
    for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

const actionHalf = (el: AdwSplitButton): HTMLButtonElement =>
    el.querySelector('.adw-split-button-action') as HTMLButtonElement;

const dropdownHalf = (el: AdwSplitButton): HTMLButtonElement =>
    el.querySelector('.adw-split-button-dropdown') as HTMLButtonElement;

/** What the action half actually shows: an icon, a label, or nothing. */
function renderedMode(el: AdwSplitButton): 'icon' | 'label' | 'empty' {
    const action = actionHalf(el);
    if (action.querySelector('.adw-icon') !== null) return 'icon';
    return (action.textContent ?? '').length > 0 ? 'label' : 'empty';
}

/** The root style classes libadwaita derives from the content. */
function rootStyleClasses(el: AdwSplitButton): string[] {
    return ['image-button', 'text-button'].filter((cls) => el.classList.contains(cls));
}

/** The arrow node's mask class for a direction, mounted and read back off the DOM. */
function arrowClass(direction: string): string {
    const { el, host } = mount({ direction });
    const className = (dropdownHalf(el).querySelector('.adw-icon') as HTMLElement).className;
    host.remove();
    return className;
}

export const AdwSplitButtonTest = async () => {
    await describe('adw-split-button content (libadwaita conformance vectors)', async () => {
        for (const vector of SPLIT_BUTTON_CONTENT_VECTORS) {
            await it(`follows ${vector.name}`, () => {
                const { el, host } = mount();
                const seen: string[] = [];
                for (const property of NOTIFY_PROPERTIES) {
                    el.addEventListener(`notify::${property}`, () => seen.push(property));
                }

                for (const step of vector.steps) {
                    // A DOM element has no `child` slot, so clearing the content (both
                    // attributes gone) is the one child step it can express.
                    if (step.op === 'child' && step.value !== null) break;

                    seen.length = 0;
                    if (step.op === 'label') el.setAttribute('label', step.value ?? '');
                    else if (step.op === 'icon-name') el.setAttribute('icon-name', step.value ?? '');
                    else {
                        el.removeAttribute('label');
                        el.removeAttribute('icon-name');
                    }

                    // The element re-emits libadwaita's notify sequence verbatim, so the
                    // ORDER — cleared slots first, then the set one — is DOM-observable.
                    expect(seen).toStrictEqual([...step.notified]);
                    expect(el.label).toBe(step.label);
                    expect(el.iconName).toBe(step.iconName);
                    // An empty label is SET but paints nothing — the `label[0]`
                    // distinction, on screen.
                    const painted = step.mode === 'icon' ? 'icon' : (step.label ?? '').length > 0 ? 'label' : 'empty';
                    expect(renderedMode(el)).toBe(painted);
                    expect(rootStyleClasses(el)).toStrictEqual([...step.styleClasses]);
                }
                host.remove();
            });
        }

        for (const { label, iconName, classes, rule } of SPLIT_BUTTON_STYLE_CLASS_VECTORS) {
            // A split button cannot hold both slots at once, so the both-set row
            // is a pure-function case the core suite owns.
            if (label !== null && iconName !== null) continue;

            await it(`root classes for ${JSON.stringify(label)}/${JSON.stringify(iconName)} — ${rule}`, () => {
                const attributes: Record<string, string> = {};
                if (label !== null) attributes.label = label;
                if (iconName !== null) attributes['icon-name'] = iconName;
                const { el, host } = mount(attributes);
                expect(rootStyleClasses(el)).toStrictEqual([...classes]);
                host.remove();
            });
        }

        await it('renders the icon INSTEAD of the label, never both', () => {
            const { el, host } = mount({ label: 'Save', 'icon-name': 'document-save' });
            expect(el.label).toBe(null);
            expect(el.iconName).toBe('document-save');
            expect(actionHalf(el).textContent).toBe('');
            expect(actionHalf(el).classList.contains('icon-only')).toBe(true);
            host.remove();
        });

        await it('drops the label when its attribute is removed (the storybook icon-only path)', () => {
            const { el, host } = mount({ label: 'Save' });
            el.setAttribute('icon-name', 'document-save');
            el.removeAttribute('label');
            expect(el.label).toBe(null);
            expect(actionHalf(el).textContent).toBe('');
            host.remove();
        });

        await it('falls back to the sibling attribute when one is removed', () => {
            const { el, host } = mount({ label: 'Save', 'icon-name': 'document-save' });
            el.removeAttribute('icon-name');
            expect(el.iconName).toBe(null);
            expect(el.label).toBe('Save');
            expect(actionHalf(el).textContent).toBe('Save');
            host.remove();
        });

        await it('never trims the label — two spaces render as two spaces', () => {
            const { el, host } = mount({ label: '  ' });
            expect(el.label).toBe('  ');
            expect(actionHalf(el).textContent).toBe('  ');
            expect(rootStyleClasses(el)).toStrictEqual(['text-button']);
            host.remove();
        });

        await it('turns a stray icon name into the broken glyph, not a stray class', () => {
            const { el, host } = mount({ 'icon-name': 'a b' });
            const icon = actionHalf(el).querySelector('.adw-icon') as HTMLElement;
            // `adw-icon--a b` would have added a second, unrelated `b` class.
            expect(icon.classList.contains('b')).toBe(false);
            expect(icon.className).toBe('adw-icon adw-icon--image-missing');
            // The name was GIVEN, so the slot shows what GTK's failed lookup shows —
            // dropping the class left a visible 16px hole instead.
            expect(maskOf(icon)).toBe(fallbackMask());
            host.remove();
        });

        await it('strips the -symbolic suffix GTK names carry', () => {
            const { el, host } = mount({ 'icon-name': 'document-save-symbolic' });
            const icon = actionHalf(el).querySelector('.adw-icon') as HTMLElement;
            expect(icon.classList.contains('adw-icon--document-save')).toBe(true);
            host.remove();
        });
    });

    await describe('adw-split-button dropdown tooltip (libadwaita conformance vectors)', async () => {
        for (const { tooltip, text, rule } of SPLIT_BUTTON_TOOLTIP_VECTORS) {
            await it(`${JSON.stringify(tooltip)} → ${JSON.stringify(text)} — ${rule}`, () => {
                const { el, host } = mount({ 'dropdown-tooltip': tooltip });
                expect(dropdownHalf(el).getAttribute('aria-label')).toBe(text);
                expect(dropdownHalf(el).title).toBe(text);
                host.remove();
            });
        }

        await it('an unset tooltip still names the dropdown (WCAG 4.1.2)', () => {
            const { el, host } = mount();
            expect(dropdownHalf(el).getAttribute('aria-label')).toBe(DEFAULT_DROPDOWN_TOOLTIP);
            host.remove();
        });

        await it('clearing a set tooltip restores the default instead of blanking it', () => {
            const { el, host } = mount({ 'dropdown-tooltip': 'Save options' });
            expect(dropdownHalf(el).getAttribute('aria-label')).toBe('Save options');
            el.setAttribute('dropdown-tooltip', '');
            expect(dropdownHalf(el).getAttribute('aria-label')).toBe(DEFAULT_DROPDOWN_TOOLTIP);
            host.remove();
        });
    });

    await describe('adw-split-button direction (libadwaita conformance vectors)', async () => {
        for (const { direction, rule } of SPLIT_BUTTON_DIRECTION_VECTORS) {
            await it(`${direction} — ${rule}`, () => {
                const { el, host } = mount({ direction });
                expect(el.direction).toBe(direction);
                const arrow = dropdownHalf(el).querySelector('.adw-icon') as HTMLElement;
                expect(arrow.className.startsWith('adw-icon adw-icon--')).toBe(true);
                if (direction === 'up') expect(arrow.style.transform).toBe('rotate(180deg)');
                host.remove();
            });
        }

        await it('`none` draws the DOWN caret, not the open-menu hamburger (_buttons.scss:621-623)', () => {
            // `open-menu` on `none` is the PLAIN menubutton glyph, and inside a
            // `splitbutton` that rule is overridden — so the symbolic name comes from
            // `splitButtonArrowIcon` and only the glyph→mask mapping is decided here.
            expect(arrowClass('none')).toBe(arrowClass('down'));
            expect(arrowClass('none').includes('adw-icon--open-menu')).toBe(false);
        });

        await it('ignores a direction that is not a GtkArrowType', () => {
            const { el, host } = mount({ direction: 'sideways' });
            expect(el.direction).toBe('down');
            host.remove();
        });
    });

    await describe('adw-split-button menu', async () => {
        for (const { json, entries, rule } of SPLIT_BUTTON_MENU_PARSE_VECTORS) {
            await it(`parses ${JSON.stringify(json)} into ${entries.length} entries — ${rule}`, () => {
                const { el, host } = mount(json === null ? {} : { menu: json });
                expect([...el.menuItems]).toStrictEqual([...entries]);
                expect(el.querySelectorAll('.adw-split-button-menu-item').length).toBe(entries.length);
                host.remove();
            });
        }

        await it('a menu-less split button has an INSENSITIVE dropdown', () => {
            const { el, host } = mount({ label: 'Save' });
            expect(el.dropdownEnabled).toBe(false);
            expect(dropdownHalf(el).disabled).toBe(true);
            dropdownHalf(el).click();
            expect(el.active).toBe(false);
            // The popover must stay hidden — it used to open, empty and styled.
            expect((el.querySelector('.adw-split-button-menu') as HTMLElement).hidden).toBe(true);
            host.remove();
        });

        await it('opens and closes on the dropdown half once there is a menu', () => {
            const { el, host } = mount({ menu: '[{"label":"Save as…","action":"app.save-as"}]' });
            expect(el.dropdownEnabled).toBe(true);
            expect(dropdownHalf(el).disabled).toBe(false);

            const active: boolean[] = [];
            el.addEventListener('notify::active', (event) => active.push((event as CustomEvent).detail.active));

            dropdownHalf(el).click();
            expect(el.active).toBe(true);
            expect(dropdownHalf(el).getAttribute('aria-expanded')).toBe('true');
            expect((el.querySelector('.adw-split-button-menu') as HTMLElement).hidden).toBe(false);

            dropdownHalf(el).click();
            expect(el.active).toBe(false);
            expect(active).toStrictEqual([true, false]);
            host.remove();
        });

        await it('dispatches a duplicate label BY POSITION, with its own action', () => {
            const { el, host } = mount({
                menu: '[{"label":"Copy","action":"app.copy"},{"label":"Copy","action":"app.copy-special"}]',
            });
            const activated: Array<{ label: string; action?: string; index: number }> = [];
            el.addEventListener('menu-activated', (event) => activated.push((event as CustomEvent).detail));

            dropdownHalf(el).click();
            const items = el.querySelectorAll('.adw-split-button-menu-item');
            (items[1] as HTMLButtonElement).click();

            expect(activated).toStrictEqual([{ label: 'Copy', action: 'app.copy-special', index: 1 }]);
            expect(el.active).toBe(false);
            host.remove();
        });

        await it('losing its menu closes an open one', () => {
            const { el, host } = mount({ menu: '[{"label":"Print"}]' });
            dropdownHalf(el).click();
            expect(el.active).toBe(true);
            el.setAttribute('menu', '[]');
            expect(el.active).toBe(false);
            expect(el.dropdownEnabled).toBe(false);
            host.remove();
        });
    });

    await describe('adw-split-button signals + state classes', async () => {
        await it('emits clicked from the action half, and not while disabled', () => {
            const { el, host } = mount({ label: 'Save' });
            let clicks = 0;
            el.addEventListener('clicked', () => clicks++);
            actionHalf(el).click();
            expect(clicks).toBe(1);

            el.setAttribute('disabled', '');
            expect(actionHalf(el).disabled).toBe(true);
            actionHalf(el).click();
            expect(clicks).toBe(1);
            host.remove();
        });

        await it('marks the root checked while the menu is open (the update_state fold)', () => {
            const { el, host } = mount({ menu: '[{"label":"Print"}]' });
            expect(el.classList.contains('checked')).toBe(false);
            dropdownHalf(el).click();
            expect(el.classList.contains('checked')).toBe(true);
            el.popdown();
            expect(el.classList.contains('checked')).toBe(false);
            host.remove();
        });
    });

    // The two behaviours a hand-rolled popover with only an outside-click handler cannot
    // give: leaving by keyboard, and reaching the items with the arrow keys. Both come
    // from `<gtk-popover>`, and these cases prove the lift was a lift, not a move.
    await describe('adw-split-button menu keyboard (gained with <gtk-popover>)', async () => {
        await it('Escape dismisses the menu and returns focus to the dropdown half', () => {
            const { el, host } = mount({ menu: '[{"label":"Print"},{"label":"Export"}]' });
            dropdownHalf(el).click();
            expect(el.active).toBe(true);

            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

            expect(el.active).toBe(false);
            // SplitButtonState stays the source of truth: a dismissal the popover owns is
            // fed back into it, not held only there.
            expect(el.classList.contains('checked')).toBe(false);
            expect(document.activeElement).toBe(dropdownHalf(el));
            host.remove();
        });

        await it('Escape reaches notify::active, so the dismissal is a real state change', () => {
            const { el, host } = mount({ menu: '[{"label":"Print"}]' });
            const seen: boolean[] = [];
            el.addEventListener('notify::active', (event) => seen.push((event as CustomEvent).detail.active));

            dropdownHalf(el).click();
            document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

            expect(seen).toStrictEqual([true, false]);
            host.remove();
        });

        await it('the arrow keys walk the menu items and wrap, from the row focused on open', () => {
            const { el, host } = mount({ menu: '[{"label":"Print"},{"label":"Export"},{"label":"Share"}]' });
            dropdownHalf(el).click();

            // Queried AFTER opening on purpose: `_renderMenu` runs on every state change
            // and `replaceChildren()`s the rows, so nodes captured before the click are
            // detached and can never be `document.activeElement`. The popover ELEMENT
            // survives; only its children are rebuilt.
            const items = [...el.querySelectorAll<HTMLButtonElement>('.adw-split-button-menu-item')];
            expect(items.length).toBe(3);
            // Opening focuses the first row — without that there is nothing to move from.
            expect(document.activeElement).toBe(items[0]);

            const menu = el.querySelector('gtk-popover') as HTMLElement;
            const press = (key: string) => menu.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));

            press('ArrowDown');
            expect(document.activeElement).toBe(items[1]);
            press('ArrowDown');
            expect(document.activeElement).toBe(items[2]);
            press('ArrowDown');
            expect(document.activeElement).toBe(items[0]); // wraps past the end
            press('ArrowUp');
            expect(document.activeElement).toBe(items[2]); // wraps past the start
            press('End');
            expect(document.activeElement).toBe(items[2]);
            press('Home');
            expect(document.activeElement).toBe(items[0]);

            el.popdown();
            host.remove();
        });

        await it('Enter on a focused row activates it BY POSITION, exactly once', () => {
            const { el, host } = mount({ menu: '[{"label":"Copy"},{"label":"Copy"}]' });
            const seen: number[] = [];
            el.addEventListener('menu-activated', (event) => seen.push((event as CustomEvent).detail.index));

            dropdownHalf(el).click();
            const menu = el.querySelector('gtk-popover') as HTMLElement;
            menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
            menu.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

            // Two entries share a label, so only position tells them apart; and
            // `preventDefault()` before the synthetic click keeps a focused <button> from
            // ALSO activating natively and firing twice.
            expect(seen).toStrictEqual([1]);
            host.remove();
        });
    });

    // The core vectors pin the numbers against the vendored stylesheet; only a COMPUTED
    // read pins what the browser paints, which is how a 9px surface under a two-layer
    // shadow shipped. A rule that loses the cascade reads fine in the SCSS source.
    await describe('adw-split-button menu surface (libadwaita popover vectors)', async () => {
        /** The `popover.menu` row of the shared table — what this element renders. */
        const menuVector = POPOVER_SURFACE_VECTORS.find((vector) => vector.variant === 'menu');
        const itemVector = POPOVER_SURFACE_VECTORS.find((vector) => vector.variant === 'menu-item');

        await it('the vectors this suite drives are present', () => {
            // A `find` that missed would make every assertion below vacuous.
            expect(menuVector !== undefined).toBe(true);
            expect(itemVector !== undefined).toBe(true);
        });

        await it(`draws a ${menuVector?.borderRadius}px surface with ${menuVector?.padding}px padding and a THREE-layer shadow`, () => {
            const { el, host } = mount({ menu: '[{"label":"Print"}]' });
            dropdownHalf(el).click();
            const surface = el.querySelector('gtk-popover') as HTMLElement;
            const style = getComputedStyle(surface);

            expect(style.paddingTop).toBe(`${menuVector?.padding}px`);
            expect(style.paddingLeft).toBe(`${menuVector?.padding}px`);
            // $popover_radius = $menu_radius + 6 = 15px. This element drew 9px.
            expect(style.borderTopLeftRadius).toBe(`${menuVector?.borderRadius}px`);

            for (const geometry of menuVector?.shadow ?? []) {
                expect(style.boxShadow.includes(geometry)).toBe(true);
            }
            // Every layer carries exactly one colour function, so counting them
            // counts the layers — this element shipped two where GTK has three.
            expect((style.boxShadow.match(/rgba?\(/g) ?? []).length).toBe(menuVector?.shadow.length);

            el.popdown();
            host.remove();
        });

        await it(`draws menu rows at the ${itemVector?.borderRadius}px modelbutton radius`, () => {
            const { el, host } = mount({ menu: '[{"label":"Print"}]' });
            dropdownHalf(el).click();
            const row = el.querySelector('.adw-split-button-menu-item') as HTMLElement;
            const style = getComputedStyle(row);

            // $menu_radius, not the `calc(var(--button-radius) - 2px)` (7px) this
            // element and the menu button each invented separately.
            expect(style.borderTopLeftRadius).toBe(`${itemVector?.borderRadius}px`);
            expect(style.paddingLeft).toBe(`${itemVector?.padding}px`);

            el.popdown();
            host.remove();
        });
    });
};
