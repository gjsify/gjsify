// DOM-level tests for <gtk-action-bar>. The bar has ONE property, `revealed`, and everything
// else about it is WHERE a child lands: `[start]` appends, `[end]` PREpends, `[center]` is the
// centre widget and a child with no type packs from the start (gtkactionbar.c:220-235,
// `gtk_action_bar_pack_end` :262-277).
import { describe, expect, it } from '@gjsify/unit';

import type { GtkActionBar } from './elements/gtk-action-bar.js';

function mount(attrs: Record<string, string> = {}): { el: GtkActionBar; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-action-bar') as GtkActionBar;
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

export const GtkActionBarTest = async () => {
    await describe('<gtk-action-bar> placement', async () => {
        await it('appends a `start` child and PREPENDS an `end` one', async () => {
            // gtk_action_bar_pack_start is an append and pack_end a PREPEND, so the FIRST
            // `[end]` child sits nearest the edge (gtkactionbar.c:255-277).
            const { el, host } = mount();
            el.append(child('start', 'a'), child('end', 'z'), child('start', 'b'), child('end', 'y'));
            // Adoption is the MutationObserver's, so it lands on the next microtask
            // (`src/slotted-children.ts`).
            await Promise.resolve();
            expect([...(el.startSection?.children ?? [])].map((n) => n.textContent)).toStrictEqual(['a', 'b']);
            expect([...(el.endSection?.children ?? [])].map((n) => n.textContent)).toStrictEqual(['y', 'z']);
            host.remove();
        });

        await it('packs an untyped child from the start', async () => {
            // gtkactionbar.c:233-234 — `type == NULL` is pack_start.
            const { el, host } = mount();
            const loose = child(undefined, 'loose');
            el.appendChild(loose);
            await Promise.resolve();
            expect(loose.parentElement).toBe(el.startSection);
            host.remove();
        });

        await it('routes `center` to the centre section', async () => {
            // gtk_action_bar_set_center_widget (:306-...) — there is no `center-widget`
            // PROPERTY in GTK, which is why the slot is spelled `center`.
            const { el, host } = mount();
            const centre = child('center', 'mid');
            el.appendChild(centre);
            await Promise.resolve();
            expect(centre.parentElement).toBe(el.centerSection);
            host.remove();
        });

        await it('a late child reaches the same place a declared one does', async () => {
            const { el, host } = mount();
            const late = child('end', 'late');
            el.appendChild(late);
            await Promise.resolve();
            expect(late.parentElement).toBe(el.endSection);
            host.remove();
        });
    });

    await describe('<gtk-action-bar> revealed', async () => {
        await it('defaults to TRUE, so only revealed="false" hides the bar', () => {
            // gtkactionbar.c:183 — the property's default is TRUE.
            const { el, host } = mount();
            expect(el.revealed).toBe(true);
            expect(el.hidden).toBe(false);
            host.remove();
        });

        await it('hides and shows through the property', () => {
            const { el, host } = mount({ revealed: 'false' });
            expect(el.revealed).toBe(false);
            expect(el.hidden).toBe(true);
            el.revealed = true;
            expect(el.hidden).toBe(false);
            host.remove();
        });
    });
};
