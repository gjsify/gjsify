// A maximized or fullscreen `Gtk.Window` ignores its default size and fills the work area
// (gtkwindow.c); on a page that is the frame's containing block. Driven through layout, because
// the claim is about the box, not about a class name. One body for the three window elements.
import { describe, expect, it } from '@gjsify/unit';

import type { GtkWindow } from './elements/gtk-window.js';

const TAGS = ['gtk-window', 'adw-window', 'adw-application-window'] as const;

function mount(tag: string, attrs: Record<string, string> = {}): { el: GtkWindow; host: HTMLElement } {
    const host = document.createElement('div');
    host.style.cssText = 'position:relative;width:500px;height:400px';
    document.body.appendChild(host);
    const el = document.createElement(tag) as GtkWindow;
    el.setAttribute('default-width', '360');
    el.setAttribute('default-height', '240');
    for (const [name, value] of Object.entries(attrs)) el.setAttribute(name, value);
    host.appendChild(el);
    return { el, host };
}

function size(el: HTMLElement): string {
    const rect = el.getBoundingClientRect();
    return `${Math.round(rect.width)}x${Math.round(rect.height)}`;
}

export const WindowMaximizeTest = async () => {
    for (const tag of TAGS) {
        await describe(`<${tag}> maximized fills its containing block`, async () => {
            await it('opens at the default size, fills the box maximized, and restores on unmaximize', async () => {
                const { el, host } = mount(tag);
                expect(size(el)).toBe('360x240');
                el.maximize();
                expect(size(el)).toBe('500x400');
                expect(el.style.width).toBe('');
                el.unmaximize();
                expect(size(el)).toBe('360x240');
                host.remove();
            });

            await it('fills the box through the `maximized` property and `toggle-maximized`', async () => {
                const { el, host } = mount(tag);
                el.maximized = true;
                expect(size(el)).toBe('500x400');
                el.maximized = false;
                expect(size(el)).toBe('360x240');
                el.dispatchEvent(new CustomEvent('window-action', { detail: { action: 'toggle-maximized' } }));
                expect(size(el)).toBe('500x400');
                el.dispatchEvent(new CustomEvent('window-action', { detail: { action: 'toggle-maximized' } }));
                expect(size(el)).toBe('360x240');
                host.remove();
            });

            await it('fills the box fullscreened and restores on unfullscreen', async () => {
                const { el, host } = mount(tag);
                el.fullscreen();
                expect(el.is_fullscreen()).toBe(true);
                expect(size(el)).toBe('500x400');
                el.unfullscreen();
                expect(size(el)).toBe('360x240');
                host.remove();
            });

            await it('stays filled until both states are gone', async () => {
                const { el, host } = mount(tag);
                el.maximize();
                el.fullscreen();
                el.unmaximize();
                expect(size(el)).toBe('500x400');
                el.unfullscreen();
                expect(size(el)).toBe('360x240');
                host.remove();
            });

            await it('fills the box already maximized when it is connected', async () => {
                const { el, host } = mount(tag, { maximized: 'true' });
                expect(size(el)).toBe('500x400');
                host.remove();
            });
        });
    }

    await describe('<adw-window> maximized keeps its size request as a minimum', async () => {
        await it('does not shrink below width-request/height-request', async () => {
            const { el, host } = mount('adw-window', { 'width-request': '600', 'height-request': '450' });
            el.maximize();
            const [width, height] = size(el).split('x').map(Number);
            expect(width >= 600).toBe(true);
            expect(height >= 450).toBe(true);
            host.remove();
        });
    });
};
