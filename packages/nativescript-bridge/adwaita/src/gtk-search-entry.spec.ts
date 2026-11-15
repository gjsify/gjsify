// `Gtk.SearchEntry` — a text field with a search icon, a clear button and a delayed
// `search-changed` — against the platform double.

import { describe, expect, it } from '@gjsify/unit';

import * as Gtk from './namespace/gtk.js';

const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

const clearButton = (entry: Gtk.SearchEntry): { visibility: string } =>
    (entry as unknown as { _clearButton: { visibility: string } })._clearButton;

export const GtkSearchEntryNsTest = async () => {
    await describe('Gtk.SearchEntry', async () => {
        await it('starts with GTK defaults', () => {
            const entry = new Gtk.SearchEntry();
            expect(entry.searchDelay).toBe(150);
            expect(entry.text).toBe('');
            expect(entry.className).toBe('adw-entry adw-search-entry search');
            expect(entry instanceof Gtk.Entry).toBe(true);
            expect(clearButton(entry).visibility).toBe('collapse');
        });

        await it('notifies search-delay only when it changes', () => {
            const entry = new Gtk.SearchEntry();
            let notified = 0;
            entry.connect('notify::search-delay', () => notified++);
            entry.set_search_delay(150);
            expect(notified).toBe(0);
            entry.set_search_delay(300);
            expect(entry.get_search_delay()).toBe(300);
            expect(notified).toBe(1);
        });

        await it('waits for the delay before search-changed, and each change replaces the queue', async () => {
            const entry = new Gtk.SearchEntry({ searchDelay: 20 });
            let fired = 0;
            entry.connect('search-changed', () => fired++);
            entry.set_text('a');
            await wait(8);
            entry.set_text('ab');
            await wait(14);
            expect(fired).toBe(0);
            await wait(20);
            expect(fired).toBe(1);
        });

        await it('emits search-changed at once when the text goes empty, and drops the queue', async () => {
            const entry = new Gtk.SearchEntry({ searchDelay: 15 });
            const seen: string[] = [];
            entry.connect('search-changed', () => seen.push(entry.text));
            entry.set_text('abc');
            entry.set_text('');
            expect(seen).toStrictEqual(['']);
            await wait(35);
            expect(seen).toStrictEqual(['']);
        });

        await it('shows the clear button only for a non-empty text, and the button empties it', () => {
            const entry = new Gtk.SearchEntry();
            const button = clearButton(entry);
            entry.text = 'x';
            expect(button.visibility).toBe('visible');
            (button as unknown as { notify(data: object): void }).notify({ eventName: 'tap', object: button });
            expect(entry.text).toBe('');
            expect(button.visibility).toBe('collapse');
        });

        await it('grab_focus answers like the platform focus()', () => {
            const entry = new Gtk.SearchEntry();
            expect(typeof entry.grab_focus()).toBe('boolean');
        });
    });
};
