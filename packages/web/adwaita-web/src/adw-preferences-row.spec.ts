// DOM-level tests for <adw-preferences-row>: the four properties that are ALL about
// the title label (adw-preferences-row.c:118-170) — `title` as Pango markup,
// `use-markup`, `use-underline`, `title-selectable` — plus the one port decision the
// element's header records, that this base row presents the title rather than
// presenting nothing as C does (adw-preferences-row.c:20).
import { describe, expect, it } from '@gjsify/unit';

import type { AdwPreferencesRow } from './elements/adw-preferences-row.js';

function mount(
    attributes: Record<string, string | true> = {},
    children: Node[] = [],
): {
    el: AdwPreferencesRow;
    host: HTMLElement;
} {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('adw-preferences-row') as AdwPreferencesRow;
    for (const [name, value] of Object.entries(attributes)) {
        if (value === true) el.setAttribute(name, '');
        else el.setAttribute(name, value);
    }
    host.appendChild(el);
    for (const child of children) el.appendChild(child);
    return { el, host };
}

/** The title label the element builds, which is what all four properties drive. */
function titleEl(el: AdwPreferencesRow): HTMLElement {
    return el.querySelector('.adw-row-title') as HTMLElement;
}

/** Where a `child` property lands, so a caller can put the preference's controls beside it. */
function contentEl(el: AdwPreferencesRow): HTMLElement {
    return el.querySelector('.adw-preferences-row-content') as HTMLElement;
}

export const AdwPreferencesRowTest = async () => {
    await describe('<adw-preferences-row> the title', async () => {
        await it('presents it, which is the one place this port departs from C', () => {
            const { el, host } = mount({ title: 'Appearance' });
            expect(titleEl(el).textContent).toBe('Appearance');
            expect(titleEl(el).hidden).toBe(false);
            host.remove();
        });

        await it("is a list item of the group's list, and says so", () => {
            const { el, host } = mount({ title: 'Appearance' });
            expect(el.getAttribute('role')).toBe('listitem');
            host.remove();
        });

        await it('an absent title is C\'s NULL → "" — no line at all', () => {
            const { el, host } = mount();
            expect(el.title).toBe('');
            expect(titleEl(el).hidden).toBe(true);
            // `row_has_title` keeps such a row out of the preferences search, and the
            // element keeps its title empty so that check agrees.
            expect(el.title).toBe('');
            host.remove();
        });

        await it('an emptied title drops the attribute rather than leaving "" behind', () => {
            const { el, host } = mount({ title: 'Appearance' });
            el.title = '';
            expect(el.hasAttribute('title')).toBe(false);
            expect(titleEl(el).hidden).toBe(true);
            host.remove();
        });
    });

    await describe('<adw-preferences-row> use-markup and use-underline', async () => {
        await it("reduces markup when use-markup is set — C's TRUE default, opt-in here", () => {
            const marked = mount({ title: '<b>Dark</b> Style', 'use-markup': true });
            expect(titleEl(marked.el).textContent).toBe('Dark Style');
            // Text in the DOM either way: `use-markup` chooses what the title MEANS, and
            // the string is never parsed as HTML.
            expect(titleEl(marked.el).querySelector('b')).toBeNull();
            marked.host.remove();

            const plain = mount({ title: '<b>Dark</b> Style' });
            expect(titleEl(plain.el).textContent).toBe('<b>Dark</b> Style');
            plain.host.remove();
        });

        await it('takes the `_` out when use-underline is set', () => {
            const { el, host } = mount({ title: '_Appearance', 'use-underline': true });
            expect(titleEl(el).textContent).toBe('Appearance');
            host.remove();
        });

        await it('reduces markup FIRST, so an underscore inside a tag survives', () => {
            const { el, host } = mount({
                title: '<span font_desc="Sans">_Style</span>',
                'use-markup': true,
                'use-underline': true,
            });
            expect(titleEl(el).textContent).toBe('Style');
            host.remove();
        });

        await it('reports both flags as the attributes carry them', () => {
            const { el, host } = mount({ 'use-markup': true });
            expect(el.useMarkup).toBe(true);
            expect(el.useUnderline).toBe(false);
            expect(el.titleSelectable).toBe(false);
            host.remove();
        });
    });

    await describe('<adw-preferences-row> title-selectable', async () => {
        await it('makes the title copyable, which is `Gtk.Label:selectable` in the DOM', () => {
            const { el, host } = mount({ title: 'Appearance', 'title-selectable': true });
            expect(el.titleSelectable).toBe(true);
            expect(titleEl(el).style.userSelect).toBe('text');
            host.remove();
        });

        await it('leaves it unselectable by default', () => {
            const { el, host } = mount({ title: 'Appearance' });
            expect(titleEl(el).style.userSelect).toBe('');
            host.remove();
        });
    });

    await describe('<adw-preferences-row> the child property', async () => {
        await it('routes a `slot="child"` control into the content box, after the title', async () => {
            const switchRow = document.createElement('adw-switch-row');
            switchRow.setAttribute('slot', 'child');
            const { el, host } = mount({ title: 'Night Light' }, [switchRow]);
            await new Promise<void>((resolve) => setTimeout(resolve, 0));
            expect(el.child).toBe(switchRow);
            expect(contentEl(el).contains(switchRow)).toBe(true);
            // The title comes FIRST, the control after it — a row, not a column.
            expect(el.firstElementChild).toBe(titleEl(el));
            host.remove();
        });

        await it('accepts the child as a property too', () => {
            const { el, host } = mount({ title: 'Night Light' });
            const control = document.createElement('gtk-switch');
            el.child = control;
            expect(el.child).toBe(control);
            expect(contentEl(el).children.length).toBe(1);
            el.child = null;
            expect(el.child).toBeNull();
            host.remove();
        });
    });

    await describe('<adw-preferences-row> notification', async () => {
        await it('emits one notify:: per observed attribute', async () => {
            const { el, host } = mount({ title: 'Appearance' });
            const seen: string[] = [];
            el.addEventListener('notify::title', (event) => seen.push((event as CustomEvent).detail.title));
            el.title = 'Theme';
            el.title = 'Theme 2';
            expect(seen).toStrictEqual(['Theme', 'Theme 2']);
            expect(titleEl(el).textContent).toBe('Theme 2');
            host.remove();
        });
    });
};
