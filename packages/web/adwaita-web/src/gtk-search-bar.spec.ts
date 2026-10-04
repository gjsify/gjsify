// DOM-level tests for `<gtk-search-bar>`: the revealer IS `search-mode-enabled`
// (gtksearchbar.c:183-205), and the four ways a search starts and the two it stops are all in
// gtksearchbar.c.
//
// The one rule worth a row of its own is that hiding CLEARS the entry (gtksearchbar.c:197-203):
// a search that is dismissed must leave nothing behind, and that is a rule about the STATE,
// not about the animation.

import { describe, expect, it } from '@gjsify/unit';

import type { GtkSearchBar } from './elements/gtk-search-bar.js';

function mount(showClose = true): GtkSearchBar {
    const el = document.createElement('gtk-search-bar') as GtkSearchBar;
    const field = document.createElement('input');
    field.className = 'adw-entry';
    el.appendChild(field);
    if (showClose) el.setAttribute('show-close-button', '');
    document.body.appendChild(el);
    return el;
}

function unmountAll(): void {
    for (const el of Array.from(document.querySelectorAll('gtk-search-bar'))) el.remove();
}

/** The box the C builds around the child, named because `inert` is not on `Element`. */
function boxOf(el: GtkSearchBar): HTMLElement {
    return el.querySelector<HTMLElement>('.adw-search-bar-box') as HTMLElement;
}

const key = (target: HTMLElement, name: string, init: KeyboardEventInit = {}): KeyboardEvent => {
    const event = new KeyboardEvent('keydown', { key: name, bubbles: true, cancelable: true, ...init });
    target.dispatchEvent(event);
    return event;
};

export const GtkSearchBarTest = async () => {
    await describe('<gtk-search-bar> search mode', async () => {
        await it('starts collapsed and inert, as a revealer whose child is not mapped', () => {
            const el = mount();
            expect(el.searchModeEnabled).toBe(false);
            expect(el.classList.contains('revealed')).toBe(false);
            expect(boxOf(el).inert).toBe(true);
            unmountAll();
        });

        await it('reveals, focuses the entry and leaves the collapsed state', () => {
            const el = mount();
            el.searchModeEnabled = true;
            expect(el.classList.contains('revealed')).toBe(true);
            expect(boxOf(el).inert).toBe(false);
            expect(document.activeElement).toBe(el.entry);
            unmountAll();
        });

        await it('clears the entry when it is hidden, and only then', () => {
            const el = mount();
            const entry = el.entry as HTMLInputElement;
            el.searchModeEnabled = true;
            entry.value = 'ada';
            expect(entry.value).toBe('ada');
            el.searchModeEnabled = false;
            expect(entry.value).toBe('');
            unmountAll();
        });

        await it('notifies once per real change', () => {
            const el = mount();
            const seen: unknown[] = [];
            el.addEventListener('notify::search-mode-enabled', (event) => seen.push((event as CustomEvent).detail));
            el.searchModeEnabled = true;
            el.searchModeEnabled = true;
            el.searchModeEnabled = false;
            expect(seen).toStrictEqual([{ searchModeEnabled: true }, { searchModeEnabled: false }]);
            unmountAll();
        });
    });

    await describe('<gtk-search-bar> the close button', async () => {
        await it('is hidden until `show-close-button` is set', () => {
            const without = mount(false);
            expect(without.showCloseButton).toBe(false);
            expect(without.querySelector<HTMLButtonElement>('.adw-search-bar-close')?.hidden).toBe(true);
            const with_ = mount(true);
            expect(with_.showCloseButton).toBe(true);
            expect(with_.querySelector<HTMLButtonElement>('.adw-search-bar-close')?.hidden).toBe(false);
            unmountAll();
        });

        await it('turns the search off when pressed', () => {
            const el = mount();
            el.searchModeEnabled = true;
            (el.querySelector('.adw-search-bar-close') as HTMLButtonElement).click();
            expect(el.searchModeEnabled).toBe(false);
            unmountAll();
        });

        await it('notifies once per real change', () => {
            const el = mount(false);
            const seen: unknown[] = [];
            el.addEventListener('notify::show-close-button', (event) => seen.push((event as CustomEvent).detail));
            el.showCloseButton = true;
            el.showCloseButton = true;
            expect(seen).toStrictEqual([{ showCloseButton: true }]);
            unmountAll();
        });
    });

    await describe('<gtk-search-bar> what starts a search', async () => {
        await it('Escape inside the bar hides it', () => {
            const el = mount();
            el.searchModeEnabled = true;
            key(el, 'Escape');
            expect(el.searchModeEnabled).toBe(false);
            unmountAll();
        });

        await it('typing into the connected editable reveals it', () => {
            const el = mount();
            const entry = el.entry as HTMLInputElement;
            entry.value = 'a';
            entry.dispatchEvent(new Event('input', { bubbles: true }));
            expect(el.searchModeEnabled).toBe(true);
            unmountAll();
        });

        await it('a printable key on the capture widget opens the bar and goes into the entry', () => {
            const el = mount();
            const capture = document.createElement('div');
            document.body.appendChild(capture);
            el.keyCaptureWidget = capture;
            const event = key(capture, 'a');
            expect(event.defaultPrevented).toBe(true);
            expect(el.searchModeEnabled).toBe(true);
            expect(el.entry?.value).toBe('a');
            unmountAll();
            capture.remove();
        });

        await it('a modified or functional key is left to the widget that owns it', () => {
            const el = mount();
            const capture = document.createElement('div');
            document.body.appendChild(capture);
            el.keyCaptureWidget = capture;
            key(capture, 'a', { ctrlKey: true });
            key(capture, 'ArrowDown');
            expect(el.searchModeEnabled).toBe(false);
            unmountAll();
            capture.remove();
        });

        await it('stops listening once the capture widget is dropped', () => {
            const el = mount();
            const capture = document.createElement('div');
            document.body.appendChild(capture);
            el.keyCaptureWidget = capture;
            el.keyCaptureWidget = null;
            key(capture, 'a');
            expect(el.searchModeEnabled).toBe(false);
            unmountAll();
            capture.remove();
        });
    });

    await describe('<gtk-search-bar> a11y', async () => {
        await it('carries the `search` role GTK declares for it', () => {
            const el = mount();
            expect(el.getAttribute('role')).toBe('search');
            unmountAll();
        });

        await it("keeps the author's child inside the box the C builds around it", () => {
            const el = mount();
            expect(el.querySelector('.adw-search-bar-center input')).not.toBeNull();
            unmountAll();
        });
    });
};
