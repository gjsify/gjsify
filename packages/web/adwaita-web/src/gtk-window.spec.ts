// DOM-level tests for <gtk-window>. A window in a page is a FRAME, and this file holds that
// honest: the two shapes its titlebar strip can be in (the application's `titlebar` slot, or
// the server-side decoration a page has to draw for itself), the four properties that decide
// which frame buttons appear, and the two branches of `gtk_window_close`
// (gtkwindow.c:1274-1287).
import { describe, expect, it } from '@gjsify/unit';

import { driveWindowVectors, WINDOW_VECTORS, type WindowSubject } from '@gjsify/adwaita-core/conformance';

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

/** The `Gtk.Window` conformance subject for any window element (`gtk-window`, `adw-window`, …). */
export function webWindowSubject(tag: string): { subject: WindowSubject; dispose: () => void } {
    const windows = new Map<object, HTMLElement>();
    const subject: WindowSubject = {
        name: `<${tag}>`,
        isOracle: false,
        capabilities: { maximizable: true, observesFocus: true, hideOnClose: true },
        create({ hideOnClose }) {
            // Never in a page: not realized, which is GTK's state for a window before `present()`.
            const el = document.createElement(tag) as GtkWindow;
            if (hideOnClose) el.setAttribute('hide-on-close', 'true');
            el.append(document.createElement('button'), document.createElement('button'));
            return el;
        },
        show(w) {
            const host = document.createElement('div');
            document.body.appendChild(host);
            host.appendChild(w as GtkWindow);
            windows.set(w, host);
            (w as GtkWindow).present();
        },
        connect(w, signal, handler) {
            (w as GtkWindow).addEventListener(signal, (event) => {
                if (signal === 'close-request') {
                    if (event.defaultPrevented) return;
                    if (handler()) {
                        event.preventDefault();
                        event.stopImmediatePropagation();
                    }
                    return;
                }
                handler();
            });
            return 1;
        },
        close: (w) => void (w as GtkWindow).close(),
        maximize: (w) => (w as GtkWindow).maximize(),
        unmaximize: (w) => (w as GtkWindow).unmaximize(),
        isMaximized: (w) => (w as GtkWindow).is_maximized(),
        getDefaultSize: (w) => (w as GtkWindow).get_default_size(),
        setDefaultSize: (w, width, height) => (w as GtkWindow).set_default_size(width, height),
        isVisible: (w) => (w as GtkWindow).isConnected && !(w as GtkWindow).hidden,
        focusables: (w) => [...(w as GtkWindow).querySelectorAll('button')] as unknown as [Element, Element],
        setFocus: (w, widget) => (w as GtkWindow).set_focus(widget as Element | null),
        getFocus: (w) => (w as GtkWindow).get_focus(),
    };
    return {
        subject,
        dispose: () => {
            for (const host of windows.values()) host.remove();
        },
    };
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

        await it('answers an unset title as a string and clears it with null', async () => {
            // `HTMLElement.title` is a `string`; a `string | null` getter broke every consumer's
            // type check of the emitted `.d.ts`.
            const { el, host } = mount();
            expect(el.title).toBe('');
            el.title = 'Learn6502';
            expect(el.title).toBe('Learn6502');
            el.title = null;
            expect(el.title).toBe('');
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

    // The element's native close contract is `preventDefault()`; a GTK handler "returns true". The
    // adapter below is that mapping, and it also stops later listeners, which is what the handled
    // accumulator does. So the "third never runs" row exercises the adapter plus the element's
    // sequence, not DOM dispatch alone.
    const { subject: webSubject, dispose } = webWindowSubject('gtk-window');
    await driveWindowVectors(webSubject, { describe, it, expect }, WINDOW_VECTORS);
    dispose();

    await describe('<gtk-window> GObject door', async () => {
        await it('a close-request handler returning true is preventDefault', async () => {
            const { el, host } = mount();
            let later = 0;
            el.connect('close-request', () => true);
            el.addEventListener('close-request', () => void later++);
            expect(el.close()).toBe(false);
            expect(el.isConnected).toBe(true);
            expect(later).toBe(0);
            host.remove();
        });

        await it('a handler that returns nothing lets the default run', async () => {
            const { el, host } = mount();
            let seen = 0;
            el.connect('close-request', () => void seen++);
            expect(el.close()).toBe(true);
            expect(seen).toBe(1);
            expect(el.isConnected).toBe(false);
            host.remove();
        });

        await it('connect hands the window to the handler and disconnect removes it', async () => {
            const { el, host } = mount();
            let seen: unknown[] = [];
            const id = el.connect('notify::title', (emitter) => void seen.push(emitter));
            el.title = 'a';
            expect(seen).toStrictEqual([el]);
            el.disconnect(id);
            el.title = 'b';
            expect(seen.length).toBe(1);
            host.remove();
        });

        await it('notify::is-active and notify::maximized are connectable', async () => {
            const { el, host } = mount();
            let maximized = 0;
            el.connect('notify::is-active', () => {});
            el.connect('notify::maximized', () => void maximized++);
            el.maximize();
            expect(maximized).toBe(1);
            host.remove();
        });

        await it('an undeclared signal is refused by name', async () => {
            const { el, host } = mount();
            let message = '';
            try {
                el.connect('toggled', () => {});
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes("'toggled'")).toBe(true);
            host.remove();
        });

        await it("emit('close-request') is refused, close() is the way", async () => {
            const { el, host } = mount();
            let message = '';
            try {
                el.emit('close-request');
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('close()')).toBe(true);
            host.remove();
        });

        await it('is_active and focus_widget are properties, as in GJS', async () => {
            const { el, host } = mount();
            const button = document.createElement('button');
            el.append(button);
            await Promise.resolve();
            expect(typeof el.is_active).toBe('boolean');
            expect(el.get_property('is-active')).toBe(el.is_active);
            el.focus_widget = button;
            expect(el.focus_widget).toBe(button);
            expect(el.get_property('focus-widget')).toBe(button);
            el.set_property('title', 'x');
            expect(el.title).toBe('x');
            host.remove();
        });

        await it('is-active is read-only through set_property', async () => {
            const { el, host } = mount();
            let message = '';
            try {
                el.set_property('is-active', true);
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('read-only')).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-window> state members', async () => {
        await it('a frame that was never connected is not realized: close() does nothing', async () => {
            const el = document.createElement('gtk-window') as GtkWindow;
            let seen = 0;
            el.addEventListener('close-request', () => void seen++);
            expect(el.close()).toBe(false);
            expect(seen).toBe(0);
        });

        await it('is-active follows the document focus and notifies only on change', async () => {
            const { el, host } = mount();
            const seen: boolean[] = [];
            el.addEventListener('notify::is-active', (e) => seen.push((e as CustomEvent).detail['is-active']));
            const before = el.isActive;
            expect(before).toBe(document.hasFocus());
            el.hidden = true;
            expect(el.is_active).toBe(false);
            el.present();
            expect(el.isActive).toBe(document.hasFocus());
            // Every transition above is one notification at most, and none repeats a value.
            for (let i = 1; i < seen.length; i++) expect(seen[i]).not.toBe(seen[i - 1]);
            host.remove();
            expect(el.isActive).toBe(false);
        });

        await it('is-active has no setter: GTK declares it read-only', async () => {
            const { el, host } = mount();
            const descriptor =
                Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el.constructor.prototype), 'isActive') ??
                Object.getOwnPropertyDescriptor(el.constructor.prototype, 'isActive');
            expect(descriptor?.set).toBe(undefined);
            host.remove();
        });

        await it('set_focus refuses an element outside the frame, by name', async () => {
            const { el, host } = mount();
            const outside = document.createElement('button');
            document.body.append(outside);
            let message = '';
            try {
                el.set_focus(outside);
            } catch (error) {
                message = (error as Error).message;
            }
            expect(message.includes('set_focus')).toBe(true);
            outside.remove();
            host.remove();
        });

        await it('focus-widget notifies with the widget in its detail', async () => {
            const { el, host } = mount();
            const button = document.createElement('button');
            el.append(button);
            await Promise.resolve();
            let detail: unknown;
            el.addEventListener('notify::focus-widget', (e) => (detail = (e as CustomEvent).detail['focus-widget']));
            el.set_focus(button);
            expect(detail).toBe(button);
            expect(el.focusWidget).toBe(button);
            host.remove();
        });

        await it('is_maximized() reads the frame state', async () => {
            const { el, host } = mount();
            expect(el.is_maximized()).toBe(false);
            el.maximize();
            expect(el.is_maximized()).toBe(true);
            host.remove();
        });
    });
};
