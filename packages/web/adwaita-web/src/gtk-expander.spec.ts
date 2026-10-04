// DOM-level tests for <gtk-expander>. What matters is the disclosure itself — the
// `expanded` flag, the `:checked` state GTK puts on the ARROW node rather than on the
// widget, the `label` / `label-widget` precedence, and the `Alt`+mnemonic that
// `gtk_expander_new_with_mnemonic` documents — plus the node tree, because the stylesheet
// selects on `expander-widget > box > title`.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkExpander } from './elements/gtk-expander.js';

function mount(
    attrs: Record<string, string> = {},
    labelWidget = false,
): {
    el: GtkExpander;
    host: HTMLElement;
} {
    const host = document.createElement('div');
    document.body.appendChild(host);
    host.style.width = '260px';
    const el = document.createElement('gtk-expander') as GtkExpander;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    if (labelWidget) {
        const badge = document.createElement('span');
        badge.id = 'badge';
        badge.setAttribute('slot', 'label');
        el.appendChild(badge);
    }
    const body = document.createElement('div');
    body.id = 'body';
    body.style.height = '40px';
    el.appendChild(body);
    host.appendChild(el);
    return { el, host };
}

/** Collect the `detail` of every `event` dispatched on `el`. */
function record(el: HTMLElement, event: string): unknown[] {
    const details: unknown[] = [];
    el.addEventListener(event, (e) => details.push((e as CustomEvent).detail));
    return details;
}

export const GtkExpanderTest = async () => {
    await describe('<gtk-expander> disclosure', async () => {
        await it('builds the node tree the stylesheet selects on', () => {
            const { el, host } = mount({ label: 'More options' });
            const box = el.querySelector('.adw-expander-box') as HTMLElement;
            const title = box.querySelector('.adw-expander-title') as HTMLElement;
            expect(box.children[0]).toBe(title);
            expect((box.children[1] as HTMLElement).classList.contains('adw-expander-content')).toBe(true);
            // GTK gives the WIDGET the button role (gtkexpander.c:393) and the arrow is its
            // own node; here the title carries the role because it is what is pressed.
            expect(title.getAttribute('role')).toBe('button');
            expect(title.tabIndex).toBe(0);
            expect((title.firstElementChild as HTMLElement).classList.contains('adw-expander-arrow')).toBe(true);
            host.remove();
        });

        await it('starts collapsed with the child out of the box', () => {
            const { el, host } = mount({ label: 'More options' });
            expect(el.expanded).toBe(false);
            const title = el.querySelector('.adw-expander-title') as HTMLElement;
            expect(title.getAttribute('aria-expanded')).toBe('false');
            // `gtk_expander_set_child` parents the child into the box only while expanded
            // (gtkexpander.c:909-923), so a collapsed expander does not lay it out.
            expect((el.querySelector('.adw-expander-content') as HTMLElement).hidden).toBe(true);
            host.remove();
        });

        await it('marks the ARROW, not the widget, with :checked', () => {
            const { el, host } = mount({ label: 'More options' });
            const arrow = el.querySelector('.adw-expander-arrow') as HTMLElement;
            expect(arrow.classList.contains('checked')).toBe(false);
            el.expanded = true;
            // gtkexpander.c:897-900 — GTK_STATE_FLAG_CHECKED goes on `arrow_widget`.
            expect(arrow.classList.contains('checked')).toBe(true);
            el.expanded = false;
            expect(arrow.classList.contains('checked')).toBe(false);
            host.remove();
        });

        await it('a click toggles it, notifies once per change, and emits activate', () => {
            const { el, host } = mount({ label: 'More options' });
            const title = el.querySelector('.adw-expander-title') as HTMLElement;
            const expanded = record(el, 'notify::expanded');
            const activated = record(el, 'activate');
            title.click();
            expect(el.expanded).toBe(true);
            title.click();
            expect(el.expanded).toBe(false);
            expect(expanded).toStrictEqual([{ expanded: true }, { expanded: false }]);
            expect(activated).toStrictEqual([{ expanded: true }, { expanded: false }]);
            host.remove();
        });

        await it('names the disclosed row for aria-controls', () => {
            const { el, host } = mount({ label: 'More options' });
            const title = el.querySelector('.adw-expander-title') as HTMLElement;
            expect(title.getAttribute('aria-controls')).toBe(el.child?.id);
            expect(el.child?.id).not.toBe('');
            host.remove();
        });
    });

    await describe('<gtk-expander> label', async () => {
        await it('makes the text a GtkLabel, as gtk_expander_set_label does', () => {
            const { el, host } = mount({ label: '_More options', 'use-underline': '' });
            const label = el.querySelector('.adw-expander-title > gtk-label') as HTMLElement;
            expect(el.label).toBe('_More options');
            // The very reduction `<gtk-label>` applies to its own `label`, so the expander's
            // title and a bare label show the same string.
            expect(label.getAttribute('label')).toBe('More options');
            expect(label.getAttribute('use-underline')).toBe('');
            host.remove();
        });

        await it('leaves markup alone unless use-markup says otherwise', () => {
            const { el, host } = mount({ label: '<b>Bold</b> options' });
            const label = el.querySelector('.adw-expander-title > gtk-label') as HTMLElement;
            expect(label.getAttribute('label')).toBe('<b>Bold</b> options');
            el.useMarkup = true;
            expect(label.getAttribute('use-markup')).toBe('');
            expect(label.getAttribute('label')).toBe('Bold options');
            host.remove();
        });

        await it("a label widget takes the place of the text, as the C's NULL label does", () => {
            const { el, host } = mount({ label: 'More options' }, true);
            expect(el.labelWidget?.id).toBe('badge');
            // `gtk_expander_set_label` NULLs the label widget (gtkexpander.c:969-970), so
            // the two are mutually exclusive and the widget wins.
            expect(el.label).toBe(null);
            expect((el.querySelector('.adw-expander-title > gtk-label') as HTMLElement).hidden).toBe(true);
            host.remove();
        });

        await it('Alt plus the marked character activates, as the constructor documents', () => {
            const { el, host } = mount({ label: '_More options', 'use-underline': '' });
            const title = el.querySelector('.adw-expander-title') as HTMLElement;
            title.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', altKey: true, bubbles: true }));
            expect(el.expanded).toBe(true);
            title.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', altKey: true, bubbles: true }));
            // `gtk_label_get_mnemonic_keyval` binds the FIRST marked character only.
            expect(el.expanded).toBe(true);
            title.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', bubbles: true }));
            expect(el.expanded).toBe(true);
            host.remove();
        });

        await it('an escaped __ marks nothing, exactly as stripMnemonic reads it', () => {
            const { el, host } = mount({ label: '__More _options', 'use-underline': '' });
            const title = el.querySelector('.adw-expander-title') as HTMLElement;
            expect(title.querySelector('gtk-label')?.getAttribute('label')).toBe('_More options');
            title.dispatchEvent(new KeyboardEvent('keydown', { key: 'o', altKey: true, bubbles: true }));
            expect(el.expanded).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-expander> resize-toplevel', async () => {
        await it('is reflected, because a document reflows itself', () => {
            const { el, host } = mount({ label: 'More', 'resize-toplevel': '' });
            expect(el.resizeToplevel).toBe(true);
            expect(el.classList.contains('resize-toplevel')).toBe(true);
            el.resizeToplevel = false;
            expect(el.classList.contains('resize-toplevel')).toBe(false);
            host.remove();
        });
    });
};
