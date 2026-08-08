// DOM-level conformance tests for <adw-split-button>, driven by the SAME vectors
// the NativeScript renderer asserts against (`@gjsify/adwaita-core/conformance`).
//
// The two renderers used to carry independent split-button logic, and the copies
// had drifted apart AND away from libadwaita: this element rendered the label AND
// the icon at once where GTK clears whichever slot it is not using, could not
// clear the label at all (so the storybook's icon-only mode showed the icon next
// to a stale "Save"), trimmed `label="  "` away, hardcoded "Menu" as the
// dropdown's accessible name and left it EMPTY for `dropdown-tooltip=""`, and
// opened a fully styled empty popover when there was no menu at all. Nothing
// failed, because nothing compared them. This suite is that comparison.
import { describe, expect, it } from '@gjsify/unit';

import { DEFAULT_DROPDOWN_TOOLTIP } from '@gjsify/adwaita-core';
import {
    SPLIT_BUTTON_CONTENT_VECTORS,
    SPLIT_BUTTON_DIRECTION_VECTORS,
    SPLIT_BUTTON_MENU_PARSE_VECTORS,
    SPLIT_BUTTON_STYLE_CLASS_VECTORS,
    SPLIT_BUTTON_TOOLTIP_VECTORS,
} from '@gjsify/adwaita-core/conformance';
import type { SplitButtonProperty } from '@gjsify/adwaita-core';
import type { AdwSplitButton } from './elements/adw-split-button.js';

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
 * Mount a split button, setting attributes through `setAttribute` rather than
 * parsed HTML — several vectors hinge on exact whitespace (`label="  "`), which
 * an attribute value in markup is not a reliable carrier for.
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
                    // A DOM element has no `child` slot; clearing the content is
                    // the one child step it can express (both attributes gone).
                    if (step.op === 'child' && step.value !== null) break;

                    seen.length = 0;
                    if (step.op === 'label') el.setAttribute('label', step.value ?? '');
                    else if (step.op === 'icon-name') el.setAttribute('icon-name', step.value ?? '');
                    else {
                        el.removeAttribute('label');
                        el.removeAttribute('icon-name');
                    }

                    // The element re-emits libadwaita's notify sequence verbatim,
                    // so the ORDER — cleared slots first, then the set one — is
                    // observable from the DOM.
                    expect(seen).toStrictEqual([...step.notified]);
                    expect(el.label).toBe(step.label);
                    expect(el.iconName).toBe(step.iconName);
                    // An empty label is SET but paints nothing, so it reads as an
                    // empty action half — the `label[0]` distinction, on screen.
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

        await it('keeps a stray icon name out of the class list', () => {
            const { el, host } = mount({ 'icon-name': 'a b' });
            const icon = actionHalf(el).querySelector('.adw-icon') as HTMLElement;
            // `adw-icon--a b` would have added a second, unrelated `b` class.
            expect(icon.classList.contains('b')).toBe(false);
            expect(icon.className).toBe('adw-icon');
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
                // `none` pops down but must NOT draw the down arrow.
                if (direction === 'none') expect(arrow.classList.contains('adw-icon--open-menu')).toBe(true);
                if (direction === 'up') expect(arrow.style.transform).toBe('rotate(180deg)');
                host.remove();
            });
        }

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
            // Activating an entry dismisses the menu.
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
};
