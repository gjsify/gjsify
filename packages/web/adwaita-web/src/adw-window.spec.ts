// DOM-level behaviour tests for <adw-window>. Runs in a real browser via the
// @gjsify/adwaita-web browser test axis (tests/browser Playwright harness). The
// custom elements are registered by importing the package root in test.browser.mts;
// these specs create elements via document.createElement and assert their DOM
// behaviour (content area, breakpoints, dialog tracking).
import { describe, it, expect } from '@gjsify/unit';
import { driveWindowVectors, WINDOW_VECTORS } from '@gjsify/adwaita-core/conformance';

import { webWindowSubject } from './gtk-window.spec.js';

import type { AdwWindow } from './elements/adw-window.js';

function makeWindow(html = '<p>Content</p>'): AdwWindow {
    const el = document.createElement('adw-window') as AdwWindow;
    el.innerHTML = html;
    document.body.appendChild(el);
    return el;
}

/** Wait for a ResizeObserver delivery (it runs after layout, before paint). */
function settle(): Promise<void> {
    return new Promise((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    });
}

export const AdwWindowTest = async () => {
    // `Adw.Window` IS a `Gtk.Window` upstream: the same vectors that run against real GTK and
    // <gtk-window> must hold here, or the state members have fallen off the subclass again.
    const { subject, dispose } = webWindowSubject('adw-window');
    await driveWindowVectors(subject, { describe, it, expect }, WINDOW_VECTORS);
    dispose();
    await describe('adw-window content', async () => {
        await it('places children in the content area', async () => {
            const win = makeWindow('<p id="hello">Hello</p>');
            const content = win.querySelector('.adw-window-content');
            expect(content?.querySelector('#hello')?.textContent).toBe('Hello');
            win.remove();
        });

        await it('content property returns the first child of the content area', async () => {
            const win = makeWindow('<p id="first">First</p><p id="second">Second</p>');
            expect(win.content?.id).toBe('first');
            win.remove();
        });

        await it('content setter moves an element into the content area', async () => {
            const win = makeWindow();
            const p = document.createElement('p');
            p.id = 'moved';
            win.content = p;
            expect(win.querySelector('.adw-window-content')?.querySelector('#moved')).toBe(p);
            win.remove();
        });

        await it('keeps 360×200 as a minimum and fills the viewport without an authored size', async () => {
            const win = makeWindow();
            expect(win.style.minWidth).toBe('360px');
            expect(win.style.minHeight).toBe('200px');
            expect(win.style.width).toBe('');
            expect(win.style.height).toBe('');
            expect(Math.round(win.getBoundingClientRect().width)).toBe(document.documentElement.clientWidth);
            expect(Math.round(win.getBoundingClientRect().height)).toBe(window.innerHeight);
            win.remove();
        });

        await it('width-request/height-request override the minimum; gtk-window has none', async () => {
            const win = document.createElement('adw-window') as AdwWindow;
            win.setAttribute('width-request', '100');
            win.setAttribute('height-request', '50');
            document.body.appendChild(win);
            expect(win.style.minWidth).toBe('100px');
            expect(win.style.minHeight).toBe('50px');
            win.remove();
            const plain = document.createElement('gtk-window');
            document.body.appendChild(plain);
            expect(plain.style.minWidth).toBe('');
            expect(plain.style.minHeight).toBe('');
            plain.remove();
        });

        await it('width/height attributes override the default size', async () => {
            const win = document.createElement('adw-window') as AdwWindow;
            win.setAttribute('width', '500');
            win.setAttribute('height', '400');
            document.body.appendChild(win);
            expect(win.style.width).toBe('500px');
            expect(win.style.height).toBe('400px');
            win.remove();
        });
    });

    await describe('adw-window breakpoints', async () => {
        await it('addBreakpoint() returns a breakpoint and tracks it', async () => {
            const win = makeWindow();
            const bp = win.addBreakpoint('max-width: 500px');
            expect(win.breakpoints.length).toBe(1);
            expect(win.breakpoints[0]).toBe(bp);
            win.remove();
        });

        await it('currentBreakpoint is null when no breakpoint is applied', async () => {
            const win = makeWindow();
            win.addBreakpoint('max-width: 100px');
            // The window is wider than 100px in the test viewport.
            expect(win.currentBreakpoint).toBeNull();
            win.remove();
        });

        // A window is what a client-side route change re-parents, and `disconnectedCallback`
        // releases the observer — so the bind has to come back on the next connect.
        await it('re-binds the breakpoints after the window is re-attached', async () => {
            const win = makeWindow();
            win.addBreakpoint('max-width: 300px');
            await settle();
            expect(win.dataset.breakpoint).toBeUndefined();

            win.remove();
            document.body.appendChild(win);
            win.setAttribute('width', '200');
            await settle();

            expect(win.dataset.breakpoint).toBe('max-width: 300px');
            expect(win.currentBreakpoint).toBe(win.breakpoints[0]!);
            win.remove();
        });
    });

    await describe('adw-window dialog tracking', async () => {
        await it('tracks open dialogs presented inside the window', async () => {
            const win = makeWindow();
            const dialog = document.createElement('adw-dialog') as HTMLElement & { present(): void };
            dialog.innerHTML = '<p>Dialog content</p>';
            win.appendChild(dialog);
            dialog.present();
            expect(win.dialogs.length).toBe(1);
            expect(win.visibleDialog).toBe(dialog);
            dialog.remove();
            win.remove();
        });

        await it('stops tracking a dialog when it closes', async () => {
            const win = makeWindow();
            const dialog = document.createElement('adw-dialog') as HTMLElement & { present(): void; close(): void };
            dialog.innerHTML = '<p>Dialog content</p>';
            win.appendChild(dialog);
            dialog.present();
            expect(win.dialogs.length).toBe(1);
            dialog.close();
            expect(win.dialogs.length).toBe(0);
            expect(win.visibleDialog).toBeNull();
            dialog.remove();
            win.remove();
        });
    });
};
