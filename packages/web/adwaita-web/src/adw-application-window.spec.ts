// DOM-level behaviour tests for <adw-application-window>. Runs in a real browser via the
// @gjsify/adwaita-web browser test axis (tests/browser Playwright harness). The custom
// elements are registered by importing the package root in test.browser.mts; these specs
// create elements via document.createElement and assert their DOM behaviour.
//
// The subject is the MENUBAR and the inheritance: `Adw.ApplicationWindow` is
// `Adw.Window` plus `Gtk.ApplicationWindow:show-menubar`, so the window half is
// <adw-window>'s spec and only the delta is asserted here.
import { describe, it, expect } from '@gjsify/unit';

import type { AdwApplicationWindow } from './elements/adw-application-window.js';

const MENU_MODEL = [
    {
        label: 'File',
        submenu: [
            { label: 'New Window', action: 'app.new-window' },
            { label: 'Quit', action: 'app.quit' },
        ],
    },
    { label: 'Help', action: 'app.help' },
];

function makeWindow(model: unknown = MENU_MODEL): AdwApplicationWindow {
    const el = document.createElement('adw-application-window') as AdwApplicationWindow;
    el.setAttribute('menu-model', JSON.stringify(model));
    el.innerHTML = '<p>Content</p>';
    document.body.appendChild(el);
    return el;
}

export const AdwApplicationWindowTest = async () => {
    await describe('adw-application-window is an adw-window', async () => {
        await it('places children in the inherited content area', async () => {
            const win = makeWindow();
            expect(win.querySelector('.adw-window-content')?.querySelector('p')?.textContent).toBe('Content');
            win.remove();
        });

        await it('keeps the inherited size request', async () => {
            const win = makeWindow();
            expect(win.style.width).toBe('360px');
            win.setAttribute('width', '520');
            expect(win.style.width).toBe('520px');
            win.remove();
        });
    });

    await describe('adw-application-window menubar', async () => {
        await it('draws no bar without show-menubar', async () => {
            const win = makeWindow();
            expect(win.showMenubar).toBe(false);
            expect(win.menubar?.hidden).toBe(true);
            win.remove();
        });

        await it('draws no bar for an application that installed no menu', async () => {
            // The GTK half of the same rule: a window with no model has no menubar,
            // however the flag reads.
            const win = makeWindow([]);
            win.setAttribute('show-menubar', '');
            expect(win.menubar?.hidden).toBe(true);
            win.remove();
        });

        await it('a submenu becomes a menu button and a bare item a flat button', async () => {
            const win = makeWindow();
            win.setAttribute('show-menubar', '');

            expect(win.menubar?.hidden).toBe(false);
            const menuButton = win.menubar?.querySelector('gtk-menu-button');
            expect(menuButton?.getAttribute('menu-title')).toBe('File');
            const help = win.menubar?.querySelector('gtk-button');
            expect(help?.getAttribute('label')).toBe('Help');
            win.remove();
        });

        await it('the menubar sits above the content, inside the content area', async () => {
            // It is a child of `.adw-window-content` rather than a sibling: the window's
            // own slot binding would re-home a sibling into the content on the next tick.
            const win = makeWindow();
            win.setAttribute('show-menubar', '');
            expect(win.contentArea.firstElementChild).toBe(win.menubar);
            win.remove();
        });

        await it('the flag alone shows and hides the bar without a rebuild', async () => {
            const win = makeWindow();
            win.setAttribute('show-menubar', '');
            expect(win.menubar?.hidden).toBe(false);
            win.removeAttribute('show-menubar');
            expect(win.menubar?.hidden).toBe(true);
            win.remove();
        });

        await it('a bare item reports its activation the way every menu surface does', async () => {
            const win = makeWindow();
            win.setAttribute('show-menubar', '');
            const seen: unknown[] = [];
            win.addEventListener('menu-item-activated', (e) => seen.push((e as CustomEvent).detail));
            (win.menubar?.querySelector('gtk-button') as HTMLButtonElement | null)?.click();
            expect(seen).toStrictEqual([{ id: 'Help', label: 'Help', path: [1] }]);
            win.remove();
        });

        await it('a broken model is dropped rather than thrown', async () => {
            // `parseMenuModel` is total by construction: a typo in markup must not take
            // the window down with it.
            const win = document.createElement('adw-application-window') as AdwApplicationWindow;
            win.setAttribute('menu-model', '{not json');
            win.setAttribute('show-menubar', '');
            document.body.appendChild(win);
            expect(win.menuModel).toStrictEqual([]);
            expect(win.menubar?.hidden).toBe(true);
            win.remove();
        });
    });
};
