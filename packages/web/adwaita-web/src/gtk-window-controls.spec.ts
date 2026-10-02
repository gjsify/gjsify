// DOM-level tests for <gtk-window-controls>. The widget is a small decision table and every
// branch of it is a line in `update_window_buttons` (gtkwindowcontrols.c:247-426): which half
// of the decoration layout `side` selects, which tokens build a button, and the four window
// properties that each token reads.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkWindowControls } from './elements/gtk-window-controls.js';
import type { GtkWindow } from './elements/gtk-window.js';

function mount(
    attrs: Record<string, string> = {},
    windowAttrs: Record<string, string> | null = null,
): {
    el: GtkWindowControls;
    host: HTMLElement;
} {
    const host = document.createElement('div');
    document.body.appendChild(host);
    let parent: HTMLElement = host;
    if (windowAttrs !== null) {
        const win = document.createElement('gtk-window') as GtkWindow;
        for (const [name, value] of Object.entries(windowAttrs)) win.setAttribute(name, value);
        host.appendChild(win);
        parent = win;
    }
    const el = document.createElement('gtk-window-controls') as GtkWindowControls;
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    parent.appendChild(el);
    return { el, host };
}

/**
 * What each child under the controls IS, in DOM order: the window icon, or the button's own
 * role class (`minimize` / `maximize` / `close`, gtkwindowcontrols.c:322, :359, :387).
 */
function children(el: GtkWindowControls): string[] {
    return [...el.children].map(
        (node) =>
            [...node.classList].find((name) => name !== 'adw-window-controls-button' && name !== 'adw-icon') ?? 'icon',
    );
}

export const GtkWindowControlsTest = async () => {
    await describe('<gtk-window-controls> defaults', async () => {
        await it('is empty outside a window, exactly as GTK returns early there', () => {
            // gtkwindowcontrols.c:257-264 — no GtkWindow root, `set_empty (self, TRUE)`.
            const { el, host } = mount();
            expect(el.empty).toBe(true);
            expect(el.classList.contains('empty')).toBe(true);
            expect(el.getAttribute('role')).toBe('group');
            expect(el.children.length).toBe(0);
            host.remove();
        });

        await it('defaults `side` to start, and `empty` to TRUE', () => {
            // :68 — PROP_SIDE's default is GTK_PACK_START; :618 — `empty` defaults TRUE.
            const { el, host } = mount();
            expect(el.side).toBe('start');
            expect(el.empty).toBe(true);
            host.remove();
        });
    });

    await describe('<gtk-window-controls> the decoration layout', async () => {
        await it('builds the three GNOME buttons inside a window, on the end half', async () => {
            // GNOME's layout is `menu:minimize,maximize,close`, and `menu` is the application
            // menu: the START half names a token GTK's loop does not build a button for
            // (gtkwindowcontrols.c:299-393), so a start-side bar is empty by construction.
            const { el, host } = mount({ side: 'end' }, {});
            expect(el.empty).toBe(false);
            expect(el.classList.contains('empty')).toBe(false);
            expect(children(el)).toStrictEqual(['minimize', 'maximize', 'close']);
            host.remove();
        });

        await it('a layout with no colon is the SAME half on both sides', async () => {
            // gtkwindowcontrols.c:150-158 — one token list, both sides, verbatim.
            const start = mount({ 'decoration-layout': 'close' }, {});
            expect(children(start.el)).toStrictEqual(['close']);
            start.host.remove();
            const end = mount({ 'decoration-layout': 'close', side: 'end' }, {});
            expect(children(end.el)).toStrictEqual(['close']);
            end.host.remove();
        });

        await it("GNOME's own layout leaves a START-side bar empty", async () => {
            // `menu:minimize,maximize,close` — the application menu is the start half, and
            // GTK's loop builds no button for a token it does not name
            // (gtkwindowcontrols.c:299-393, :416-419).
            const { el, host } = mount({}, {});
            expect(children(el)).toStrictEqual([]);
            expect(el.empty).toBe(true);
            host.remove();
        });

        await it('`side` picks the half after the first colon', async () => {
            // gtkwindowcontrols.c:141-166 — the START half is what is BEFORE the first
            // colon, so the buttons are written there and the menu section after.
            const layout = { 'decoration-layout': 'minimize,close:menu' };
            const start = mount(layout, {});
            expect(children(start.el)).toStrictEqual(['minimize', 'close']);
            start.host.remove();
            const end = mount({ ...layout, side: 'end' }, {});
            expect(children(end.el)).toStrictEqual([]);
            end.host.remove();
        });

        await it('an empty layout is the no-layout case, which is empty', async () => {
            // gtkwindowcontrols.c:140-144 — an empty string is NULL, and NULL is empty.
            const { el, host } = mount({ 'decoration-layout': '' }, {});
            expect(el.empty).toBe(true);
            host.remove();
        });

        await it('a token nothing knows builds nothing', async () => {
            // The tail of the loop (:416-419) leaves `button` NULL for an unknown token.
            const { el, host } = mount({ 'decoration-layout': 'menu,close' }, {});
            expect(children(el)).toStrictEqual(['close']);
            host.remove();
        });
    });

    await describe('<gtk-window-controls> the window it reads', async () => {
        await it('drops minimize and the icon on a modal window', async () => {
            // gtkwindowcontrols.c:272-273, :299 and :318 — `is_sovereign_window` gates both.
            const { el, host } = mount({ 'decoration-layout': 'icon,minimize,close' }, { modal: 'true' });
            expect(children(el)).toStrictEqual(['close']);
            host.remove();
        });

        await it('drops minimize and the icon on a transient window', async () => {
            const { el, host } = mount(
                { 'decoration-layout': 'icon,minimize,close' },
                {
                    'transient-for': 'main',
                },
            );
            expect(children(el)).toStrictEqual(['close']);
            host.remove();
        });

        await it('drops the icon when the window has none to show', async () => {
            // update_window_icon (:187-210) leaves the icon out when there is no paintable.
            const bare = mount({ 'decoration-layout': 'icon,close' }, {});
            expect(children(bare.el)).toStrictEqual(['close']);
            bare.host.remove();
            const named = mount({ 'decoration-layout': 'icon,close' }, { 'icon-name': 'utilities-terminal' });
            expect(children(named.el)).toStrictEqual(['icon', 'close']);
            named.host.remove();
        });

        await it('drops the maximize button while the window is not resizable', async () => {
            // gtkwindowcontrols.c:342-346 — `resizable` is the only test on this token.
            const { el, host } = mount({ side: 'end' }, { resizable: 'false' });
            expect(children(el)).toStrictEqual(['minimize', 'close']);
            host.remove();
        });

        await it('swaps maximize for restore while the window is maximized', async () => {
            // gtkwindowcontrols.c:347-350 — the glyph AND the label follow the state.
            const { el, host } = mount({ side: 'end' }, { maximized: 'true' });
            const button = el.querySelector('.maximize') as HTMLButtonElement;
            expect(button.getAttribute('aria-label')).toBe('Restore');
            expect(button.querySelector('gtk-image')?.getAttribute('icon-name')).toBe('window-restore-symbolic');
            host.remove();
        });

        await it('drops the close button while the window is not deletable', async () => {
            const { el, host } = mount({ side: 'end' }, { deletable: 'false' });
            expect(children(el)).toStrictEqual(['minimize', 'maximize']);
            host.remove();
        });

        await it('rebuilds when one of the six watched window properties moves', async () => {
            // window_notify_cb (gtkwindowcontrols.c:428-441) names exactly these six.
            const { el, host } = mount({ side: 'end' }, { deletable: 'false' });
            const win = el.closest('gtk-window') as GtkWindow;
            win.deletable = true;
            await Promise.resolve();
            await Promise.resolve();
            expect(children(el)).toStrictEqual(['minimize', 'maximize', 'close']);
            host.remove();
        });

        await it('takes the layout off the frame when it has none of its own', async () => {
            // `get_layout`'s second stop, the port's stand-in for Gtk.Settings (:129-140).
            const { el, host } = mount({ side: 'end' }, { 'decoration-layout': ':close' });
            expect(children(el)).toStrictEqual(['close']);
            host.remove();
        });
    });

    await describe('<gtk-window-controls> events', async () => {
        await it('a press asks for the action its GtkActionable name names', async () => {
            const { el, host } = mount({ 'decoration-layout': 'minimize,close', side: 'end' }, {});
            const actions: unknown[] = [];
            el.addEventListener('window-action', (e) => actions.push((e as CustomEvent).detail));
            (el.querySelector('.minimize') as HTMLButtonElement).click();
            (el.querySelector('.close') as HTMLButtonElement).click();
            expect(actions).toStrictEqual([{ action: 'minimize' }, { action: 'close' }]);
            host.remove();
        });

        await it('`empty` notifies only when it moves', async () => {
            // set_empty (gtkwindowcontrols.c:216-230) returns early on an unchanged value.
            const { el, host } = mount({ side: 'end' }, {});
            const events: unknown[] = [];
            el.addEventListener('notify::empty', (e) => events.push((e as CustomEvent).detail));
            const win = el.closest('gtk-window') as GtkWindow;
            win.setAttribute('decoration-layout', '');
            win.setAttribute('decoration-layout', '');
            await Promise.resolve();
            await Promise.resolve();
            win.setAttribute('decoration-layout', ':close');
            await Promise.resolve();
            await Promise.resolve();
            expect(events).toStrictEqual([{ empty: true }, { empty: false }]);
            host.remove();
        });

        await it('a `side` write notifies with the property, not the attribute', async () => {
            const { el, host } = mount({ side: 'start' }, {});
            const events: unknown[] = [];
            el.addEventListener('notify::side', (e) => events.push((e as CustomEvent).detail));
            el.side = 'start';
            el.side = 'end';
            el.side = 'end';
            expect(events).toStrictEqual([{ side: 'end' }]);
            host.remove();
        });
    });
};
