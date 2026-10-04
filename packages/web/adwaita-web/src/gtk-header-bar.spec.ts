// DOM-level tests for <gtk-header-bar>. The bar is three separable things: WHERE a child
// lands (`start` appends, `end` prepends, an untyped child packs from the start —
// gtkheaderbar.c:843-861), the two window controls `show-title-buttons` creates and destroys
// (:198-249, :798-826), and the centre either/or between a `title-widget` and the derived
// `GtkLabel` (:274-290, :313-341).
import { describe, expect, it } from '@gjsify/unit';

import type { GtkHeaderBar } from './elements/gtk-header-bar.js';
import type { GtkWindow } from './elements/gtk-window.js';

function bar(attrs: Record<string, string> = {}): { el: GtkHeaderBar; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-header-bar') as GtkHeaderBar;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

function child(slot: string | undefined, text: string): HTMLElement {
    const el = document.createElement('span');
    if (slot !== undefined) el.setAttribute('slot', slot);
    el.textContent = text;
    return el;
}

function classesIn(box: HTMLElement | null): string[] {
    return [...(box?.children ?? [])].map((node) => [...node.classList].sort().join('.'));
}

export const GtkHeaderBarTest = async () => {
    await describe('<gtk-header-bar> structure', async () => {
        await it('is the CSS tree of gtkheaderbar.c:99-116', () => {
            const { el, host } = bar();
            const handle = el.firstElementChild;
            expect(handle?.className).toBe('adw-gtk-header-bar-handle');
            const box = handle?.firstElementChild;
            expect(box?.className).toBe('adw-gtk-header-bar-box');
            expect(classesIn(box as HTMLElement)).toStrictEqual([
                'adw-gtk-header-bar-start',
                'adw-gtk-header-bar-end',
                'adw-gtk-header-bar-title.title',
            ]);
            expect(el.getAttribute('role')).toBe('group');
            host.remove();
        });

        await it('appends a `start` child and PREPENDS an `end` one', async () => {
            // gtk_header_bar_pack (:843-861): gtk_box_append / gtk_box_prepend.
            const { el, host } = bar();
            const box = el.querySelector('.adw-gtk-header-bar-box') as HTMLElement;
            const start = child('start', 'a');
            const end = child('end', 'z');
            el.append(start, end);
            // Adoption is the MutationObserver's, so it lands on the next microtask
            // (`src/slotted-children.ts`).
            await Promise.resolve();
            expect(start.parentElement?.className).toBe('adw-gtk-header-bar-start');
            expect(end.parentElement?.className).toBe('adw-gtk-header-bar-end');
            // The start box opens with the PREPENDED window controls (:243), which carry no
            // text of their own — hence the leading ''.
            el.append(child('start', 'b'));
            await Promise.resolve();
            expect(
                [...box.querySelector('.adw-gtk-header-bar-start')!.children].map((n) => n.textContent),
            ).toStrictEqual(['', 'a', 'b']);
            el.append(child('end', 'y'));
            await Promise.resolve();
            // The end box closes with the APPENDED window controls (:245), and `y` PREPENDED
            // in front of `z` — the order the two halves are packed by.
            expect([...box.querySelector('.adw-gtk-header-bar-end')!.children].map((n) => n.textContent)).toStrictEqual(
                ['y', 'z', ''],
            );
            host.remove();
        });

        await it('packs an untyped child from the start', async () => {
            // gtkheaderbar.c:698 — `type == NULL` is pack_start.
            const { el, host } = bar();
            const loose = child(undefined, 'loose');
            el.appendChild(loose);
            await Promise.resolve();
            expect(loose.parentElement?.className).toBe('adw-gtk-header-bar-start');
            host.remove();
        });
    });

    await describe('<gtk-header-bar> the title', async () => {
        await it('derives it from the root window, and re-derives on notify::title', async () => {
            // gtk_header_bar_root (gtkheaderbar.c:362-376) connects notify::title on the root.
            const host = document.createElement('div');
            document.body.appendChild(host);
            const win = document.createElement('gtk-window') as GtkWindow;
            win.setAttribute('title', 'Documents');
            const el = document.createElement('gtk-header-bar') as GtkHeaderBar;
            win.appendChild(el);
            host.appendChild(win);
            const label = () => el.querySelector('.adw-gtk-header-bar-title');
            expect(label()?.getAttribute('label')).toBe('Documents');
            win.setAttribute('title', 'Documents — 12');
            await Promise.resolve();
            await Promise.resolve();
            expect(label()?.getAttribute('label')).toBe('Documents — 12');
            host.remove();
        });

        await it('falls back to the page title, which is the process name here', async () => {
            // update_title (gtkheaderbar.c:250-271) ends at g_get_application_name(), which is
            // the application's name — and a page's own <title> is that, one level up.
            const { el, host } = bar();
            expect(el.querySelector('.adw-gtk-header-bar-title')?.getAttribute('label')).toBe(document.title);
            host.remove();
        });

        await it('a title-widget takes the centre and the derived label goes', async () => {
            // gtk_header_bar_set_title_widget (:319-336): the bin is emptied first.
            const { el, host } = bar();
            const widget = child('title', 'My App');
            el.appendChild(widget);
            await Promise.resolve();
            expect(el.querySelector('.adw-gtk-header-bar-title')).toBe(null);
            expect(widget.parentElement?.className).toBe('adw-gtk-header-bar-box');
            expect(el.titleWidget).toBe(widget);
            host.remove();
        });

        await it('taking the widget away REBUILDS the derived label', async () => {
            // :332-336 — the NULL branch constructs it again. `<adw-header-bar>` cannot do
            // this; the asymmetry is what its own header records.
            const { el, host } = bar();
            const widget = child('title', 'My App');
            el.appendChild(widget);
            await Promise.resolve();
            widget.remove();
            await Promise.resolve();
            await Promise.resolve();
            expect(el.querySelector('.adw-gtk-header-bar-title')).not.toBe(null);
            expect(el.titleWidget).toBe(null);
            host.remove();
        });

        await it('accepts the deprecated `title-widget` spelling of the same slot', async () => {
            // gtkheaderbar.c:683-686 — `gtk_buildable_child_deprecation_warning` on `"title"`,
            // which the property-position spelling in a `.blp` is the replacement for.
            const { el, host } = bar();
            const widget = child('title-widget', 'My App');
            el.appendChild(widget);
            await Promise.resolve();
            expect(el.querySelector('.adw-gtk-header-bar-title')).toBe(null);
            host.remove();
        });
    });

    await describe('<gtk-header-bar> show-title-buttons', async () => {
        await it('creates one controls at each end, prepended and appended', async () => {
            // create_window_controls (gtkheaderbar.c:198-249).
            const { el, host } = bar();
            const start = el.querySelector('.adw-gtk-header-bar-start') as HTMLElement;
            const end = el.querySelector('.adw-gtk-header-bar-end') as HTMLElement;
            expect(start.firstElementChild?.localName).toBe('gtk-window-controls');
            expect(start.firstElementChild?.getAttribute('side')).toBe('start');
            expect(end.lastElementChild?.localName).toBe('gtk-window-controls');
            expect(end.lastElementChild?.getAttribute('side')).toBe('end');
            host.remove();
        });

        await it('`show-title-buttons="false"` REMOVES them rather than hiding them', async () => {
            // gtk_header_bar_set_show_title_buttons (:806-824) unparents both.
            const { el, host } = bar();
            el.showTitleButtons = false;
            expect(el.querySelector('gtk-window-controls')).toBe(null);
            el.showTitleButtons = true;
            expect(el.querySelectorAll('gtk-window-controls').length).toBe(2);
            host.remove();
        });

        await it('binds `decoration-layout` onto both controls', async () => {
            // The two G_BINDING_SYNC_CREATE bindings of :229-247.
            const { el, host } = bar();
            el.decorationLayout = 'menu:close';
            for (const controls of Array.from(el.querySelectorAll('gtk-window-controls'))) {
                expect(controls.getAttribute('decoration-layout')).toBe('menu:close');
            }
            el.decorationLayout = null;
            expect(el.querySelector('gtk-window-controls')?.hasAttribute('decoration-layout')).toBe(false);
            host.remove();
        });

        await it('notifies only on a real change', async () => {
            // From the GIR default (TRUE, :657) written out, so the first write below changes
            // nothing — `gtk_header_bar_set_show_title_buttons` returns early (:802-803).
            const { el, host } = bar({ 'show-title-buttons': 'true' });
            const events: unknown[] = [];
            el.addEventListener('notify::show-title-buttons', (e) => events.push((e as CustomEvent).detail));
            el.showTitleButtons = true;
            el.showTitleButtons = false;
            el.showTitleButtons = false;
            expect(events).toStrictEqual([{ 'show-title-buttons': false }]);
            host.remove();
        });
    });
};
