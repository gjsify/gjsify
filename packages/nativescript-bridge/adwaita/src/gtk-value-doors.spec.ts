// `Gtk.StringList` and `Gtk.Adjustment` AT THE WIDGET, held against the spelling they
// replace.
//
// THE CLAIM UNDER TEST is what each property's value IS, and it is the one claim a core-side
// spec cannot make: `@gjsify/adwaita-core` proves what the two classes hold, what a reader
// needs to know is what the WIDGET does with them.
//
// The two properties now answer DIFFERENTLY, which is why both are here. `adjustment` is still
// a convenience door: `adjustment: FONT_SIZE` and `adjustment: new Gtk.Adjustment(FONT_SIZE)`
// leave `Adw.SpinRow` in the same state, and the object literal is the shorthand. `model` is
// not, since ADR 0122: it is an object property over `Gio.ListModel`, it holds the list BY
// IDENTITY, and `model: ['Blue', 'Teal']` is a `TypeError` naming the type rather than a
// shorthand for one. The array door it replaces is asserted here as the refusal it became —
// this file is where a reader looking for `model: [...]` arrives, so this is where the answer
// belongs.
//
// This lives on the TREES entry (`src/test.trees.mts`), not the pure one: it builds the
// port's real widget classes, which evaluate `@nativescript/core` at module scope and are
// reachable only under that entry's `--alias`. The package's AGENTS.md carries the rule.

import { describe, expect, it } from '@gjsify/unit';
import {
    ROW_ACCESSOR_VECTORS,
    driveRowAccessorVectors,
    type ComboRowLike,
    type SwitchRowLike,
} from '@gjsify/adwaita-core/conformance';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';

const COLOURS = ['Blue', 'Teal', 'Green'];
const FONT_SIZE = { lower: 0, upper: 100, value: 16, stepIncrement: 1 };

/** Everything a `model` write leaves behind, as one comparable string. */
const modelState = (row: { options: unknown; selected: number; selectedValue: string }) =>
    JSON.stringify({ options: row.options, selected: row.selected, value: row.selectedValue });

/** Everything an `adjustment` write leaves behind. */
const rangeState = (row: { adjustment: unknown; value: number }) =>
    JSON.stringify({ adjustment: row.adjustment, value: row.value });

export const AdwGtkValueDoorsNsTest = async () => {
    await describe('Adw.ComboRow:model takes a Gtk.StringList and refuses an array', async () => {
        await it('holds the list by identity through the construct bag', () => {
            const list = new Gtk.StringList({ strings: COLOURS });
            const row = new Adw.ComboRow({ title: 'Accent colour', model: list, selected: 1 });

            expect(row.model === list).toBe(true);
            expect(modelState(row)).toBe(
                JSON.stringify({
                    options: COLOURS.map((colour) => ({ value: colour, label: colour })),
                    selected: 1,
                    value: 'Teal',
                }),
            );
        });

        await it('holds the list by identity through the property setter', () => {
            const list = new Gtk.StringList({ strings: COLOURS });
            const row = new Adw.ComboRow();
            row.model = list;

            expect(row.model === list).toBe(true);
            expect(row.selectedValue).toBe('Blue');
        });

        await it('follows a list that was appended to after construction', () => {
            const list = new Gtk.StringList({ strings: ['Blue'] });
            list.append('Teal');
            const row = new Adw.ComboRow({ model: list, selected: 1 });

            expect(row.selectedValue).toBe('Teal');
        });

        await it('follows a list appended to WHILE the row holds it', () => {
            const list = new Gtk.StringList({ strings: ['Blue'] });
            const row = new Adw.ComboRow({ model: list });
            list.append('Teal');
            row.selected = 1;

            expect(row.selectedValue).toBe('Teal');
        });

        // The array door this file used to assert, as the refusal it became: `model` is an
        // object property over `Gio.ListModel`, so the message is the property's own.
        await it('refuses a plain array by naming the type', () => {
            const row = new Adw.ComboRow();

            expect(() => {
                (row as unknown as { model: unknown }).model = COLOURS;
            }).toThrow("Object is not a subclass of GObject_Object, it's a Array");
        });
    });

    await describe('Gtk.DropDown:model takes a Gtk.StringList and refuses an array', async () => {
        await it('holds the list by identity', () => {
            const list = new Gtk.StringList({ strings: COLOURS });
            const dropDown = new Gtk.DropDown({ model: list, selected: 2 });

            expect(dropDown.model === list).toBe(true);
            expect(dropDown.selectedValue).toBe('Green');
        });

        await it('refuses a plain array by naming the type', () => {
            const dropDown = new Gtk.DropDown();

            expect(() => {
                (dropDown as unknown as { model: unknown }).model = COLOURS;
            }).toThrow("Object is not a subclass of GObject_Object, it's a Array");
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

    await driveRowAccessorVectors(
        {
            name: 'adwaita-nativescript',
            isOracle: false,
            makeComboRow: () => new Adw.ComboRow() as unknown as ComboRowLike,
            makeSwitchRow: () => new Adw.SwitchRow() as unknown as SwitchRowLike,
            StringList: Gtk.StringList,
        },
        { describe, it, expect },
        ROW_ACCESSOR_VECTORS,
    );
};
