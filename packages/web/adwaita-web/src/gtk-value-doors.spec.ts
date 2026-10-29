// `Gtk.StringList` and `Gtk.Adjustment` AT THE ELEMENT, held against the spelling they
// replace.
//
// THE CLAIM UNDER TEST is what each property's value IS at the ELEMENT, and it is the one
// claim a core-side spec cannot make: `@gjsify/adwaita-core` proves what the two classes
// hold, what a reader needs to know is what the element does with them — down to the
// `<option>` nodes it renders.
//
// The two properties answer DIFFERENTLY, which is why both are here. `adjustment` is still a
// convenience door: `el.adjustment = FONT_SIZE` and `el.adjustment = new Gtk.Adjustment(…)`
// leave `<adw-spin-row>` in the same state, and the object literal is the shorthand. `model`
// is not, since ADR 0122: it is an object property over `Gio.ListModel`, it holds the list BY
// IDENTITY, and `el.model = ['Blue', 'Teal']` is a `TypeError` naming the type rather than a
// shorthand for one. The array door it replaces is asserted here as the refusal it became —
// this file is where a reader looking for `el.model = [...]` arrives, so this is where the
// answer belongs. The `model` ATTRIBUTE is a separate, untouched door; `value-lists.spec.ts`
// and `adw-row-state.spec.ts` hold that one.
//
// The NativeScript port asserts the same doors at its own widget seam
// (`gtk-value-doors.spec.ts` there), so the two renderers cannot part on this without one
// of them failing.
//
// Compared as JSON rather than with `toEqual`: `@gjsify/unit`'s `toEqual` is `==`, so two
// different objects pass it whatever they hold.

import { describe, it, expect } from '@gjsify/unit';

import { GtkAdjustment, GtkStringList } from '@gjsify/adwaita-core';
import {
    ROW_ACCESSOR_VECTORS,
    driveRowAccessorVectors,
    type ComboRowLike,
    type SwitchRowLike,
} from '@gjsify/adwaita-core/conformance';

import type { AdwComboRow } from './elements/adw-combo-row.js';
import type { AdwSwitchRow } from './elements/adw-switch-row.js';
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
    JSON.stringify({ options: el.options, selected: el.selected, value: el.selectedValue, painted: options });

/** The option labels the row actually paints, which is what a reader sees. */
const comboOptions = (el: HTMLElement) =>
    [...el.querySelectorAll('option, .adw-drop-down-item-label')].map((node) => node.textContent).join('|');

export const GtkValueDoorsTest = async () => {
    await describe('<adw-combo-row>.model takes a Gtk.StringList and refuses an array', async () => {
        await it('holds the list by identity and paints what it holds', () => {
            const list = new GtkStringList({ strings: COLOURS });
            const row = mount<AdwComboRow>('adw-combo-row');
            row.model = list;
            row.selected = 1;

            expect(row.model === list).toBe(true);
            expect(modelState(row, comboOptions(row))).toBe(
                JSON.stringify({
                    options: COLOURS.map((colour) => ({ value: colour, label: colour })),
                    selected: 1,
                    value: 'Teal',
                    painted: COLOURS.join('|'),
                }),
            );
        });

        await it('follows a list that was appended to before it was assigned', () => {
            const strings = new GtkStringList({ strings: ['Blue'] });
            strings.append('Teal');
            const row = mount<AdwComboRow>('adw-combo-row');
            row.model = strings;
            row.selected = 1;

            expect(row.selectedValue).toBe('Teal');
        });

        await it('follows a list appended to WHILE the row holds it', () => {
            const strings = new GtkStringList({ strings: ['Blue'] });
            const row = mount<AdwComboRow>('adw-combo-row');
            row.model = strings;
            strings.append('Teal');
            row.selected = 1;

            expect(row.selectedValue).toBe('Teal');
        });

        // The array door this file used to assert, as the refusal it became: `model` is an
        // object property over `Gio.ListModel`, so the message is the property's own.
        await it('refuses a plain array by naming the type', () => {
            const row = mount<AdwComboRow>('adw-combo-row');

            expect(() => {
                (row as unknown as { model: unknown }).model = COLOURS;
            }).toThrow("Object is not a subclass of GObject_Object, it's a Array");
        });
    });

    await describe('<gtk-drop-down>.model takes a Gtk.StringList and refuses an array', async () => {
        await it('holds the list by identity and paints what it holds', () => {
            const list = new GtkStringList({ strings: COLOURS });
            const dropDown = mount<GtkDropDown>('gtk-drop-down');
            dropDown.model = list;
            dropDown.selected = 2;

            expect(dropDown.model === list).toBe(true);
            expect(dropDown.selectedValue).toBe('Green');
            expect(comboOptions(dropDown)).toBe(COLOURS.join('|'));
        });

        await it('refuses a plain array by naming the type', () => {
            const dropDown = mount<GtkDropDown>('gtk-drop-down');

            expect(() => {
                (dropDown as unknown as { model: unknown }).model = COLOURS;
            }).toThrow("Object is not a subclass of GObject_Object, it's a Array");
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

    await driveRowAccessorVectors(
        {
            name: 'adwaita-web',
            isOracle: false,
            makeComboRow: () => mount<AdwComboRow>('adw-combo-row') as unknown as ComboRowLike,
            makeSwitchRow: () => mount<AdwSwitchRow>('adw-switch-row') as unknown as SwitchRowLike,
            StringList: GtkStringList,
        },
        { describe, it, expect },
        ROW_ACCESSOR_VECTORS,
    );
};
