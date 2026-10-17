// The GIR method doors of `Adw.ComboRow` and `Adw.SwitchRow` a GJS preferences dialog writes —
// `set_model(Gtk.StringList.new([…]))`, `set_selected`, `get_selected`, `set_active`,
// `get_active` — against the property each one is the accessor of. The SAME vectors run on real
// `gi://Adw` (the ORACLE: a vector that fails there is wrong, never a port bug) and on each port.
//
// Reference: refs/libadwaita/src/adw-combo-row.c (adw_combo_row_set_model, _get/_set_selected)
// Reference: refs/libadwaita/src/adw-switch-row.c (adw_switch_row_get_active, _set_active)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { ConstructHarness } from './constructs.js';

export interface StringListLike {
    get_n_items(): number;
    get_string(position: number): string | null;
}

export interface ComboRowLike {
    readonly selected: number;
    set_model(model: StringListLike | null): void;
    get_selected(): number;
    set_selected(position: number): void;
}

export interface SwitchRowLike {
    readonly active: boolean;
    get_active(): boolean;
    set_active(active: boolean): void;
}

export interface RowAccessorSubject {
    readonly name: string;
    readonly isOracle: boolean;
    makeComboRow(): ComboRowLike;
    makeSwitchRow(): SwitchRowLike;
    StringList: { new: (strings: readonly string[] | null) => StringListLike };
}

export interface RowAccessorVector {
    readonly row: string;
    readonly rule: string;
    readonly observe: (subject: RowAccessorSubject) => unknown;
    readonly shows: unknown;
}

export const ROW_ACCESSOR_VECTORS: readonly RowAccessorVector[] = [
    {
        row: 'string-list-new',
        rule: 'Gtk.StringList.new holds the strings in order; null makes an empty list',
        observe({ StringList }) {
            const list = StringList.new(['Small', 'Large']);
            return [list.get_n_items(), list.get_string(1), StringList.new(null).get_n_items()];
        },
        shows: [2, 'Large', 0],
    },
    {
        row: 'combo-set-model',
        rule: 'set_model selects the first item, as the property `model` does',
        observe(subject) {
            const row = subject.makeComboRow();
            row.set_model(subject.StringList.new(['a', 'b', 'c']));
            return [row.get_selected(), row.selected];
        },
        shows: [0, 0],
    },
    {
        row: 'combo-set-selected',
        rule: 'set_selected and get_selected are the accessors of `selected`',
        observe(subject) {
            const row = subject.makeComboRow();
            row.set_model(subject.StringList.new(['a', 'b', 'c']));
            row.set_selected(2);
            return [row.get_selected(), row.selected];
        },
        shows: [2, 2],
    },
    {
        row: 'switch-accessors',
        rule: 'set_active and get_active are the accessors of `active`',
        observe(subject) {
            const row = subject.makeSwitchRow();
            const seen = [row.get_active()];
            row.set_active(true);
            seen.push(row.get_active(), row.active);
            row.set_active(false);
            seen.push(row.get_active());
            return seen;
        },
        shows: [false, true, true, false],
    },
];

export async function driveRowAccessorVectors(
    subject: RowAccessorSubject,
    harness: ConstructHarness,
    vectors: readonly RowAccessorVector[] = ROW_ACCESSOR_VECTORS,
): Promise<void> {
    const { describe, it, expect } = harness;
    await describe(`${subject.name}: ComboRow / SwitchRow accessors`, async () => {
        for (const vector of vectors) {
            await it(`${vector.row}: ${vector.rule}`, async () => {
                const observed = await vector.observe(subject);
                expect(JSON.stringify(observed)).toBe(JSON.stringify(vector.shows));
            });
        }
    });
}
