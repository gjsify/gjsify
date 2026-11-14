// `Gtk.Align`, `Gtk.Orientation`, `Gtk.Justification`, `Gtk.SelectionMode`, `Gtk.WrapMode` and
// `Adw.ResponseAppearance` as value tables, and the constants meaning what a GJS snippet means.
//
// The nick lists the tables derive from are held against the typelib-read constants by arm 8
// of `scripts/check-nativescript-xml-doors.mjs`; these are the anchors a number written by a
// ported snippet depends on, plus the reading back through the widgets that take them.

import { describe, expect, it } from '@gjsify/unit';

import { responseAppearance, ResponseAppearance } from './widgets/adw-enums.js';
import { Align, Justification, Orientation, SelectionMode, WrapMode } from './widgets/gtk-enums.js';
import { nsAlignment } from './widgets/construct-props.js';
import { selectionMode } from './widgets/list-box-state.js';

export default async () => {
    await describe('the Gtk enum value tables', async () => {
        await it('Gtk.Align keeps the GIR numbers, with the deprecated BASELINE an alias of BASELINE_FILL', () => {
            expect([Align.FILL, Align.START, Align.END, Align.CENTER]).toStrictEqual([0, 1, 2, 3]);
            expect([Align.BASELINE_FILL, Align.BASELINE, Align.BASELINE_CENTER]).toStrictEqual([4, 4, 5]);
        });

        await it('Gtk.Orientation, Justification, SelectionMode and WrapMode count from their first member', () => {
            expect([Orientation.HORIZONTAL, Orientation.VERTICAL]).toStrictEqual([0, 1]);
            expect([Justification.LEFT, Justification.RIGHT, Justification.CENTER, Justification.FILL]).toStrictEqual([
                0, 1, 2, 3,
            ]);
            expect([SelectionMode.NONE, SelectionMode.SINGLE, SelectionMode.BROWSE, SelectionMode.MULTIPLE]).toStrictEqual([
                0, 1, 2, 3,
            ]);
            expect([WrapMode.NONE, WrapMode.CHAR, WrapMode.WORD, WrapMode.WORD_CHAR]).toStrictEqual([0, 1, 2, 3]);
        });

        await it('a table is frozen, so a snippet cannot rewrite a constant', () => {
            expect(Object.isFrozen(Align)).toBe(true);
            expect(Object.isFrozen(WrapMode)).toBe(true);
        });

        await it('the widgets take the constants the tables hold', () => {
            expect(nsAlignment(Align.CENTER, 'horizontal')).toBe('center');
            expect(nsAlignment(Align.END, 'vertical')).toBe('bottom');
            expect(selectionMode(SelectionMode.BROWSE)).toBe('browse');
        });
    });

    await describe('Adw.ResponseAppearance', async () => {
        await it('is DEFAULT 0, SUGGESTED 1, DESTRUCTIVE 2', () => {
            expect([ResponseAppearance.DEFAULT, ResponseAppearance.SUGGESTED, ResponseAppearance.DESTRUCTIVE]).toStrictEqual([
                0, 1, 2,
            ]);
        });

        await it('resolves a constant or a nick to the nick, and refuses anything else naming the members', () => {
            expect(responseAppearance(ResponseAppearance.DESTRUCTIVE)).toBe('destructive');
            expect(responseAppearance('suggested')).toBe('suggested');
            expect(() => responseAppearance(7)).toThrow('default, suggested, destructive');
            expect(() => responseAppearance('danger')).toThrow('is not a Adw.ResponseAppearance');
        });
    });
};
