// DOM-level tests for <gtk-application-window>. The subclass adds ONE strip and ONE property,
// so the file is small on purpose: `show-menubar` is `gtk_application_window_update_menubar`
// (gtkapplicationwindow.c:392-431), which shows the bar only when the property is set AND the
// section has at least one item — and the second half is the `menubar` slot here, because the
// `GMenuModel` the C reads is not something markup can carry.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkApplicationWindow } from './elements/gtk-application-window.js';

function mount(attrs: Record<string, string> = {}): { el: GtkApplicationWindow; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-application-window') as GtkApplicationWindow;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

function menubar(el: GtkApplicationWindow): HTMLElement {
    return el.querySelector('.adw-gtk-application-window-menubar') as HTMLElement;
}

export const GtkApplicationWindowTest = async () => {
    await describe('<gtk-application-window> structure', async () => {
        await it('is titlebar, menubar, content — in that order', () => {
            // update_menubar parents the bar above the window's child (:418), and
            // gtk_window_set_titlebar puts the titlebar above that.
            const { el, host } = mount();
            expect([...el.children].map((node) => node.className)).toStrictEqual([
                'adw-gtk-window-titlebar',
                'adw-gtk-application-window-menubar',
                'adw-gtk-window-content',
            ]);
            host.remove();
        });

        await it('is a Gtk.Window frame in every other respect', async () => {
            const { el, host } = mount({ title: 'Editor' });
            expect(el.decorated).toBe(true);
            expect(el.getAttribute('aria-label')).toBe('Editor');
            expect(el.querySelector('gtk-window-controls')).not.toBe(null);
            host.remove();
        });

        await it('routes a `menubar` child into the strip and everything else into the content', async () => {
            const { el, host } = mount();
            const bar = document.createElement('span');
            bar.setAttribute('slot', 'menubar');
            const body = document.createElement('span');
            el.append(bar, body);
            // Adoption is the MutationObserver's (`src/slotted-children.ts`), and the
            // menubar's OWN observer then re-runs the visibility rule — two microtasks.
            await Promise.resolve();
            await Promise.resolve();
            expect(bar.parentElement).toBe(menubar(el));
            expect(body.parentElement?.className).toBe('adw-gtk-window-content');
            host.remove();
        });
    });

    await describe('<gtk-application-window> show-menubar', async () => {
        await it('is FALSE by default, so the strip is hidden', async () => {
            // :693 — the property's default is FALSE.
            const { el, host } = mount();
            expect(el.showMenubar).toBe(false);
            expect(menubar(el).hidden).toBe(true);
            host.remove();
        });

        await it('needs an item as well as the property — an empty section shows nothing', async () => {
            // gtkapplicationwindow.c:400-402 — `should_have_menubar` is the AND of the two.
            const { el, host } = mount({ 'show-menubar': 'true' });
            expect(menubar(el).hidden).toBe(true);
            const bar = document.createElement('span');
            bar.setAttribute('slot', 'menubar');
            el.appendChild(bar);
            await Promise.resolve();
            await Promise.resolve();
            expect(menubar(el).hidden).toBe(false);
            host.remove();
        });

        await it('hides the bar again when the property goes false, keeping the child', async () => {
            // gtk_window_hide on the bar's box, not a reparent (:404-410).
            const { el, host } = mount({ 'show-menubar': 'true' });
            const bar = document.createElement('span');
            bar.setAttribute('slot', 'menubar');
            el.appendChild(bar);
            await Promise.resolve();
            await Promise.resolve();
            el.showMenubar = false;
            expect(menubar(el).hidden).toBe(true);
            expect(menubar(el).children.length).toBe(1);
            host.remove();
        });

        await it('notifies once per real change', async () => {
            const { el, host } = mount();
            const events: unknown[] = [];
            el.addEventListener('notify::show-menubar', (e) => events.push((e as CustomEvent).detail));
            el.showMenubar = true;
            el.showMenubar = true;
            expect(events).toStrictEqual([{ 'show-menubar': true }]);
            host.remove();
        });
    });
};
