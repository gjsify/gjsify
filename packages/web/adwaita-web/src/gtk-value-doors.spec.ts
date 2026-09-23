// `Gtk.StringList` and `Gtk.Adjustment` AT THE ELEMENT, held against the spelling they
// replace.
//
// THE CLAIM UNDER TEST is backward compatibility, and it is the one claim a core-side spec
// cannot make. `@gjsify/adwaita-core` proves the two classes reduce to the same value as
// the array and the object literal; what a reader needs to know is that the ELEMENT cannot
// tell them apart — that `el.model = ['Blue', 'Teal']` and
// `el.model = new Gtk.StringList({ strings: ['Blue', 'Teal'] })` leave `<adw-combo-row>` in
// the same state, down to the `<option>` nodes it renders, and likewise for the two
// adjustment spellings on `<adw-spin-row>`. Four spellings, each asserted against what the
// element shows.
//
// The NativeScript port asserts the same four at its own widget door
// (`gtk-value-doors.spec.ts` there), so the two renderers cannot part on this without one
// of them failing.
//
// Compared as JSON rather than with `toEqual`: `@gjsify/unit`'s `toEqual` is `==`, so two
// different objects pass it whatever they hold.

import { describe, it, expect } from '@gjsify/unit';

import { GtkAdjustment, GtkStringList } from '@gjsify/adwaita-core';

import type { AdwComboRow } from './elements/adw-combo-row.js';
import type { AdwSpinRow } from './elements/adw-spin-row.js';
import type { GtkDropDown } from './elements/gtk-drop-down.js';

const COLOURS = ['Blue', 'Teal', 'Green'];
const FONT_SIZE = { lower: 0, upper: 100, value: 16, stepIncrement: 1 };

function mount<T extends HTMLElement>(tag: string): T {
    const el = document.createElement(tag) as T;
    document.body.appendChild(el);
    return el;
}

/** Everything a `model` write leaves behind, the rendered options included. */
const modelState = (el: AdwComboRow | GtkDropDown, options: string) =>
    JSON.stringify({ model: el.model, selected: el.selected, value: el.selectedValue, options });

/** The option labels the row actually paints, which is what a reader sees. */
const comboOptions = (el: HTMLElement) =>
    [...el.querySelectorAll('option, .adw-drop-down-option')].map((node) => node.textContent).join('|');

export const GtkValueDoorsTest = async () => {
    await describe('<adw-combo-row> takes a plain array and a Gtk.StringList alike', async () => {
        await it('leaves the row in the same state, rendered options included', () => {
            const array = mount<AdwComboRow>('adw-combo-row');
            const list = mount<AdwComboRow>('adw-combo-row');
            array.model = COLOURS;
            list.model = new GtkStringList({ strings: COLOURS });
            array.selected = 1;
            list.selected = 1;

            expect(modelState(list, comboOptions(list))).toBe(modelState(array, comboOptions(array)));
            expect(list.selectedValue).toBe('Teal');
        });

        await it('follows a list that was appended to before it was assigned', () => {
            const strings = new GtkStringList({ strings: ['Blue'] });
            strings.append('Teal');
            const row = mount<AdwComboRow>('adw-combo-row');
            row.model = strings;
            row.selected = 1;

            expect(row.selectedValue).toBe('Teal');
        });
    });

    await describe('<gtk-drop-down> takes a plain array and a Gtk.StringList alike', async () => {
        await it('leaves the drop-down in the same state', () => {
            const array = mount<GtkDropDown>('gtk-drop-down');
            const list = mount<GtkDropDown>('gtk-drop-down');
            array.model = COLOURS;
            list.model = new GtkStringList({ strings: COLOURS });
            array.selected = 2;
            list.selected = 2;

            expect(modelState(list, comboOptions(list))).toBe(modelState(array, comboOptions(array)));
            expect(list.selectedValue).toBe('Green');
        });
    });

    await describe('<adw-spin-row> takes a plain object and a Gtk.Adjustment alike', async () => {
        await it('leaves the row in the same state', () => {
            const literal = mount<AdwSpinRow>('adw-spin-row');
            const adjustment = mount<AdwSpinRow>('adw-spin-row');
            literal.adjustment = FONT_SIZE;
            adjustment.adjustment = new GtkAdjustment(FONT_SIZE);

            expect(JSON.stringify(adjustment.adjustment)).toBe(JSON.stringify(literal.adjustment));
            expect(adjustment.value).toBe(literal.value);
            expect(adjustment.value).toBe(16);
        });

        await it('steps by the increment the adjustment carries, whichever spelling set it', () => {
            const row = mount<AdwSpinRow>('adw-spin-row');
            row.adjustment = new GtkAdjustment({ ...FONT_SIZE, stepIncrement: 4 });

            expect(row.adjustment.stepIncrement).toBe(4);
            expect(row.value).toBe(16);
        });
    });
};
