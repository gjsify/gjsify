// DOM-level tests for <gtk-window>. A window in a page is a FRAME, and this file holds that
// honest: the two shapes its titlebar strip can be in (the application's `titlebar` slot, or
// the server-side decoration a page has to draw for itself), the four properties that decide
// which frame buttons appear, and the two branches of `gtk_window_close`
// (gtkwindow.c:1274-1287).
import { describe, expect, it } from '@gjsify/unit';

import type { GtkWindow } from './elements/gtk-window.js';

function mount(attrs: Record<string, string> = {}): { el: GtkWindow; host: HTMLElement } {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const el = document.createElement('gtk-window') as GtkWindow;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

function content(el: GtkWindow): HTMLElement {
    return el.querySelector('.adw-gtk-window-content') as HTMLElement;
}

function titlebar(el: GtkWindow): HTMLElement {
    return el.querySelector('.adw-gtk-window-titlebar') as HTMLElement;
}

export const GtkWindowTest = async () => {
    await describe('<gtk-window> structure', async () => {
        await it('is a titlebar strip over a content box', async () => {
            // The two strips `connectedCallback` installs, in `strips()` order.
            const { el, host } = mount();
            expect([...el.children].map((node) => node.className)).toStrictEqual([
                'adw-gtk-window-titlebar',
                'adw-gtk-window-content',
            ]);
            expect(titlebar(el).hidden).toBe(false);
            host.remove();
        });

        await it('routes every unslotted child into the content box, in document order', async () => {
            const { el, host } = mount();
            const first = document.createElement('span');
            first.textContent = 'a';
            const second = document.createElement('span');
            second.textContent = 'b';
            el.append(first, second);
            await Promise.resolve();
            expect([...content(el).children]).toStrictEqual([first, second]);
            host.remove();
        });

        await it('a `titlebar` child takes the whole strip, decorations and all', async () => {
            // GTK hands the titlebar the window's decorations; a `Gtk.HeaderBar` brings its
            // own window controls with it.
            const { el, host } = mount();
            const bar = document.createElement('gtk-header-bar');
            // `titlebar` is a PROPERTY on Gtk.Window (gtkwindow.c:1138) and the buildable's
            // single child is something else, so the slot name is how the markup spells it.
            bar.setAttribute('slot', 'titlebar');
            el.appendChild(bar);
            await Promise.resolve();
            await Promise.resolve();
            expect(bar.parentElement).toBe(titlebar(el));
            // The WINDOW's own two are gone, and the bar brings its own pair instead — which is
            // what `show-title-buttons` is for (gtkheaderbar.c:198-249).
            expect([...titlebar(el).children]).toStrictEqual([bar]);
            expect(el.querySelectorAll('gtk-window-controls').length).toBe(2);
            host.remove();
        });

        await it('with no titlebar it draws the SSD a window manager would have', async () => {
            const { el, host } = mount({ title: 'Documents' });
            expect([...titlebar(el).children].map((node) => node.localName)).toStrictEqual([
                'gtk-window-controls',
                'span',
                'gtk-window-controls',
            ]);
            expect(titlebar(el).querySelector('.adw-gtk-window-title')?.getAttribute('title')).toBe('Documents');
            host.remove();
        });

        await it('`decorated="false"` HIDES the strip, frame buttons and all', async () => {
            // gtk_window_set_decorated (gtkwindow.c:1014) takes the titlebar OUT OF THE FRAME,
            // which is not the same as discarding it: the window keeps the widget and an
            // undecorating write puts it back. So the strip is hidden, not emptied.
            const { el, host } = mount();
            el.decorated = false;
            expect(titlebar(el).hidden).toBe(true);
            expect(el.querySelector('gtk-window-controls')).not.toBe(null);
            el.decorated = true;
            expect(titlebar(el).hidden).toBe(false);
            host.remove();
        });
    });

    await describe('<gtk-window> frame properties', async () => {
        await it('`maximized` and `fullscreened` square the frame off', async () => {
            // _window.scss:66-72 — the two states with no corners and no shadow.
            const { el, host } = mount();
            el.maximized = true;
            expect(el.classList.contains('maximized')).toBe(true);
            el.maximized = false;
            el.setAttribute('fullscreened', '');
            expect(el.classList.contains('fullscreen')).toBe(true);
            host.remove();
        });

        await it('`default-width`/`default-height` size the frame, and an absent one clears it', async () => {
            const { el, host } = mount({ 'default-width': '480', 'default-height': '320' });
            expect(el.style.width).toBe('480px');
            expect(el.style.height).toBe('320px');
            el.removeAttribute('default-width');
            expect(el.style.width).toBe('');
            host.remove();
        });

        await it("`title` is the window's accessible name", async () => {
            const { el, host } = mount({ title: 'Documents' });
            expect(el.getAttribute('aria-label')).toBe('Documents');
            el.removeAttribute('title');
            expect(el.hasAttribute('aria-label')).toBe(false);
            host.remove();
        });

        await it('the frame buttons follow `deletable` and `resizable`', async () => {
            // One read each, through the controls the window draws.
            const { el, host } = mount();
            el.deletable = false;
            el.resizable = false;
            await Promise.resolve();
            await Promise.resolve();
            expect(el.querySelector('.adw-window-controls-button.close')).toBe(null);
            expect(el.querySelector('.adw-window-controls-button.maximize')).toBe(null);
            expect(el.querySelector('.adw-window-controls-button.minimize')).not.toBe(null);
            host.remove();
        });

        await it('the maximize button toggles `maximized` and says so', async () => {
            const { el, host } = mount();
            const button = el.querySelector('.adw-window-controls-button.maximize') as HTMLButtonElement;
            expect(button.getAttribute('aria-label')).toBe('Maximize');
            button.click();
            expect(el.maximized).toBe(true);
            host.remove();
        });

        await it('notifies once per real change', async () => {
            const { el, host } = mount();
            const events: unknown[] = [];
            el.addEventListener('notify::resizable', (e) => events.push((e as CustomEvent).detail));
            el.resizable = false;
            el.resizable = false;
            expect(events).toStrictEqual([{ resizable: false }]);
            host.remove();
        });
    });

    await describe('<gtk-window> close', async () => {
        await it("detaches the frame, which is GTK's destroy branch", async () => {
            // gtkwindow.c:1282-1285 — no hide-on-close, so `gtk_window_destroy`.
            const { el, host } = mount();
            let seen = 0;
            el.addEventListener('close-request', () => {
                seen += 1;
            });
            expect(el.close()).toBe(true);
            expect(seen).toBe(1);
            expect(el.isConnected).toBe(false);
            host.remove();
        });

        await it('hides the frame when `hide-on-close` is set', async () => {
            // gtkwindow.c:945 and the first branch of :1282.
            const { el, host } = mount({ 'hide-on-close': 'true' });
            el.close();
            expect(el.isConnected).toBe(true);
            expect(el.hidden).toBe(true);
            host.remove();
        });

        await it('a handler that cancels `close-request` takes the whole thing over', async () => {
            // gtkwindow.c:1300-1320 — `g_signal_stop_emission_by_name` on the default handler.
            const { el, host } = mount();
            el.addEventListener('close-request', (e) => e.preventDefault());
            expect(el.close()).toBe(false);
            expect(el.isConnected).toBe(true);
            host.remove();
        });
    });
};
