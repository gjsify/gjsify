// `Gtk.ListBox` — the pure half: `Gtk.SelectionMode`, and what a tap or a mode change does to
// the selected rows.

import { describe, expect, it } from '@gjsify/unit';

import {
    DEFAULT_LIST_SELECTION_MODE,
    GTK_SELECTION_MODES,
    selectionAfterModeChange,
    selectionAfterTap,
    selectionMode,
} from './widgets/list-box-state.js';

export default async () => {
    await describe('Gtk.SelectionMode', async () => {
        await it('has the four members in constant order, and `single` is the ListBox default', () => {
            expect([...GTK_SELECTION_MODES]).toStrictEqual(['none', 'single', 'browse', 'multiple']);
            expect(DEFAULT_LIST_SELECTION_MODE).toBe('single');
        });

        await it('takes a nick or the constant a GJS snippet writes', () => {
            expect(selectionMode('none')).toBe('none');
            expect(selectionMode(3)).toBe('multiple');
        });

        await it('refuses a word that is not a member, naming them', () => {
            expect(() => selectionMode('many')).toThrow('is not a Gtk.SelectionMode');
        });
    });

    await describe('selectionAfterTap', async () => {
        await it('selects nothing in `none`', () => {
            expect(selectionAfterTap('none', ['a'], 'b')).toStrictEqual([]);
        });

        await it('replaces the selection in `single` and `browse`', () => {
            expect(selectionAfterTap('single', ['a'], 'b')).toStrictEqual(['b']);
            expect(selectionAfterTap('browse', [], 'b')).toStrictEqual(['b']);
        });

        await it('toggles in `multiple`', () => {
            expect(selectionAfterTap('multiple', ['a'], 'b')).toStrictEqual(['a', 'b']);
            expect(selectionAfterTap('multiple', ['a', 'b'], 'a')).toStrictEqual(['b']);
        });
    });

    await describe('selectionAfterModeChange', async () => {
        await it('drops every selection for `none`', () => {
            expect(selectionAfterModeChange('none', ['a'])).toStrictEqual([]);
        });

        await it('drops a multi-selection a one-row mode cannot hold, and keeps a single row', () => {
            expect(selectionAfterModeChange('single', ['a', 'b'])).toStrictEqual([]);
            expect(selectionAfterModeChange('browse', ['a'])).toStrictEqual(['a']);
        });

        await it('keeps everything in `multiple`', () => {
            expect(selectionAfterModeChange('multiple', ['a', 'b'])).toStrictEqual(['a', 'b']);
        });
    });
};
