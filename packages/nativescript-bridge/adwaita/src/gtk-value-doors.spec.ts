// `Gtk.StringList` and `Gtk.Adjustment` AT THE WIDGET, held against the spelling they
// replace.
//
// THE CLAIM UNDER TEST is backward compatibility, and it is the one claim a core-side spec
// cannot make. `@gjsify/adwaita-core` proves the two classes reduce to the same value as
// the array and the object literal; what a reader needs to know is that the WIDGET cannot
// tell them apart — that `model: ['Blue', 'Teal']` and
// `model: new Gtk.StringList({ strings: ['Blue', 'Teal'] })` leave `Adw.ComboRow` in the
// same state, and likewise for the two adjustment spellings on `Adw.SpinRow`. Four
// spellings, each asserted against the state the widget hands back.
//
// This lives on the TREES entry (`src/test.trees.mts`), not the pure one: it builds the
// port's real widget classes, which evaluate `@nativescript/core` at module scope and are
// reachable only under that entry's `--alias`. The package's AGENTS.md carries the rule.

import { describe, expect, it } from '@gjsify/unit';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';

const COLOURS = ['Blue', 'Teal', 'Green'];
const FONT_SIZE = { lower: 0, upper: 100, value: 16, stepIncrement: 1 };

/** Everything a `model` write leaves behind, as one comparable string. */
const modelState = (row: { model: unknown; selected: number; selectedValue: string }) =>
    JSON.stringify({ model: row.model, selected: row.selected, value: row.selectedValue });

/** Everything an `adjustment` write leaves behind. */
const rangeState = (row: { adjustment: unknown; value: number }) =>
    JSON.stringify({ adjustment: row.adjustment, value: row.value });

export const AdwGtkValueDoorsNsTest = async () => {
    await describe('Adw.ComboRow takes a plain array and a Gtk.StringList alike', async () => {
        await it('leaves the row in the same state through the construct bag', () => {
            const array = new Adw.ComboRow({ title: 'Accent colour', model: COLOURS, selected: 1 });
            const list = new Adw.ComboRow({
                title: 'Accent colour',
                model: new Gtk.StringList({ strings: COLOURS }),
                selected: 1,
            });

            expect(modelState(list)).toBe(modelState(array));
            expect(list.selectedValue).toBe('Teal');
        });

        await it('leaves the row in the same state through the property setter', () => {
            const array = new Adw.ComboRow();
            const list = new Adw.ComboRow();
            array.model = COLOURS;
            list.model = new Gtk.StringList({ strings: COLOURS });

            expect(modelState(list)).toBe(modelState(array));
        });

        await it('follows a list that was appended to after construction', () => {
            const list = new Gtk.StringList({ strings: ['Blue'] });
            list.append('Teal');
            const row = new Adw.ComboRow({ model: list, selected: 1 });

            expect(row.selectedValue).toBe('Teal');
        });
    });

    await describe('Gtk.DropDown takes a plain array and a Gtk.StringList alike', async () => {
        await it('leaves the drop-down in the same state', () => {
            const array = new Gtk.DropDown({ model: COLOURS, selected: 2 });
            const list = new Gtk.DropDown({ model: new Gtk.StringList({ strings: COLOURS }), selected: 2 });

            expect(modelState(list)).toBe(modelState(array));
            expect(list.selectedValue).toBe('Green');
        });
    });

    await describe('Adw.SpinRow takes a plain object and a Gtk.Adjustment alike', async () => {
        await it('leaves the row in the same state through the construct bag', () => {
            const literal = new Adw.SpinRow({ title: 'Font size', adjustment: FONT_SIZE });
            const adjustment = new Adw.SpinRow({ title: 'Font size', adjustment: new Gtk.Adjustment(FONT_SIZE) });

            expect(rangeState(adjustment)).toBe(rangeState(literal));
            expect(adjustment.value).toBe(16);
        });

        await it('leaves the row in the same state through the property setter', () => {
            const literal = new Adw.SpinRow();
            const adjustment = new Adw.SpinRow();
            literal.adjustment = FONT_SIZE;
            adjustment.adjustment = new Gtk.Adjustment(FONT_SIZE);

            expect(rangeState(adjustment)).toBe(rangeState(literal));
        });

        await it('steps by the increment the adjustment carries, whichever spelling set it', () => {
            const row = new Adw.SpinRow({ adjustment: new Gtk.Adjustment({ ...FONT_SIZE, stepIncrement: 4 }) });
            row.value = 20;

            expect(row.adjustment.stepIncrement).toBe(4);
            expect(row.value).toBe(20);
        });
    });
};
