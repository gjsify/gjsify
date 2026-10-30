// `Adw.ComboRow`'S `model` / `selected` / `selected-item` AS DECLARED GObject MEMBERS, measured
// on the pure-JS leg (ADR 0105 § 2, route D).
//
// The row used to hand-roll all three as class accessors and dispatch a NativeScript
// `notify::selected` event with a `{ selected, value }` payload. They are declared now, so on
// Android with the real engine they are a registered GType's properties and here, on iOS and in
// the browser, the seam's own store. `tests/integration/nativescript-gi/app/specs/combo-row.ts`
// runs the same cases on a device.
//
// WHY THIS FILE EXISTS BESIDE `drop-down.spec.ts`: that one drives `ComboState` directly, because
// the drop-down is wiring over it. This one drives the WIDGET, and the column it drives is
// `notified` — the `notify::` order of ADR 0122 § 5, which the conformance header reserved for
// "a renderer that owns real GObject properties". `AdwComboRow` is the first port surface that
// does, so the order stops being a table nothing replays.
//
// It also pins the three things the migration CHANGED for a consumer: a programmatic write now
// notifies (the `interactive` carve-out, conformance divergence #1, does not apply to a declared
// property), `selected-item` is read-only by derivation rather than by a missing setter, and
// `notify::selected` carries no payload past the sender.
//
// `model` and `selected-item` are `kind: 'object'` and all three are `explicitNotify`, so all
// three are SEAM-OWNED (`isSeamOwned` in `widgets/signals.ts`): the accessor reads the seam's
// store on BOTH legs, which is what lets this off-device file speak for route D, where there is
// no harness at all.
//
// This lives on the TREES entry (`src/test.trees.mts`): `extends AdwActionRow` reaches
// `@nativescript/core` at module scope, resolvable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import { ADW_COMBO_NO_SELECTION, GjsifyOptionList } from '@gjsify/adwaita-core';
import type { ComboNotify, ComboState } from '@gjsify/adwaita-core';
import {
    COMBO_ITEMS_CHANGED_VECTORS,
    COMBO_SELECTION_VECTORS,
    type ComboSelectionStep,
} from '@gjsify/adwaita-core/conformance';

import * as Adw from './namespace/adw.js';

/** The three names, canonical spelling, as the pspecs declare them. */
const DECLARED: readonly ComboNotify[] = ['model', 'selected', 'selected-item'];

const loose = (row: Adw.ComboRow): Record<string, unknown> => row as unknown as Record<string, unknown>;

/**
 * The chooser pick, without the sheet. `_openChooser` awaits a native `action()` and then calls
 * `ComboState.select`; the sheet is the platform's and the selection is ours, so this reaches the
 * second half directly — the same seam `drop-down.spec.ts` drives.
 */
const pick = (row: Adw.ComboRow, index: number): void => {
    (row as unknown as { _state: ComboState })._state.select(index);
};

/** Record every `notify::` the row emits for a declared property, in order. */
function watch(row: Adw.ComboRow): ComboNotify[] {
    const seen: ComboNotify[] = [];
    for (const name of DECLARED) row.connect(`notify::${name}`, () => seen.push(name));
    return seen;
}

/**
 * Replay one combo vector step against the WIDGET, through the property surface a consumer has.
 * Every `setModel` builds a FRESH list, which is what makes `setModelAgain` a distinct step: a
 * declared object property compares by identity, so two equal lists are two values and only the
 * second step hands back the one the row already holds.
 */
function applyStep(row: Adw.ComboRow, step: ComboSelectionStep): void {
    switch (step.op) {
        case 'setModel':
            row.model = GjsifyOptionList.new([...step.model]);
            return;
        case 'setModelAgain': {
            // The held object written BACK — which is what the step means, and what the seam's
            // equal-write guard has to answer with silence. Through a local only because a
            // literal `row.model = row.model` is a lint error.
            const held = row.model;
            row.model = held;
            return;
        }
        case 'setSelectedIndex':
            row.selected = step.index;
            return;
        case 'setSelectedValue':
            row.selectedValue = step.value;
            return;
        case 'select':
            pick(row, step.index);
            return;
    }
}

export const AdwComboRowPropertiesNsTest = async () => {
    await describe('Adw.ComboRow: model, selected and selected-item are declared properties', async () => {
        await it("starts at adw_combo_row_init's defaults, having emitted nothing", () => {
            const row = new Adw.ComboRow();
            const seen = watch(row);
            expect(row.model).toBe(null);
            expect(row.selected).toBe(ADW_COMBO_NO_SELECTION);
            expect(row.selectedItem).toBe(null);
            expect(seen.length).toBe(0);
        });

        await it('answers each property in all three GObject spellings', () => {
            const row = new Adw.ComboRow();
            const list = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            row.model = list;
            row.selected = 1;
            const props = loose(row);
            expect(props.model).toBe(list);
            expect(props.selected).toBe(1);
            expect(props['selected-item']).toBe(row.selectedItem);
            expect(props.selected_item).toBe(row.selectedItem);
        });

        await it('is GObject-only: notify() refuses the declared names by payload', () => {
            // `notify::selected` used to be a NativeScript event with a `{ selected, value }`
            // body. Dispatching one now throws rather than quietly reaching no GObject handler.
            const row = new Adw.ComboRow();
            for (const name of DECLARED) {
                expect(() => row.notify({ eventName: `notify::${name}`, object: row as never })).toThrow();
            }
        });
    });

    await describe('Adw.ComboRow notify order (libadwaita conformance vectors)', async () => {
        for (const vector of COMBO_SELECTION_VECTORS) {
            await it(`notifies in order through: ${vector.name}`, () => {
                const row = new Adw.ComboRow();
                const seen = watch(row);

                for (const step of vector.steps) applyStep(row, step);

                expect(row.selected).toBe(vector.selected);
                expect(row.selectedValue).toBe(vector.value);
                // The whole feed and its ORDER, not just the end state: `model` ends the
                // sequence it caused, and a `selected` write puts `selected` before
                // `selected-item`. A widget that emitted the same names in another order
                // re-runs a consumer's bindings against a half-moved row.
                expect(seen).toStrictEqual([...vector.notified]);
            });
        }

        await it('a programmatic write notifies — the `interactive` carve-out is gone here', () => {
            // Conformance divergence #1 is a DOM-renderer rule: no properties, so only the user
            // path emits. A declared property has no such choice, and this row now matches the C
            // (`row_activated_cb` routes the pick through the same setter, :209).
            const row = new Adw.ComboRow();
            row.model = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            const seen = watch(row);
            row.selected = 1;
            expect(seen).toStrictEqual(['selected', 'selected-item']);
            seen.length = 0;
            pick(row, 0);
            expect(seen).toStrictEqual(['selected', 'selected-item']);
        });
    });

    await describe('Adw.ComboRow items-changed (shared conformance vectors)', async () => {
        for (const vector of COMBO_ITEMS_CHANGED_VECTORS) {
            await it(`notifies through: ${vector.name}`, () => {
                const row = new Adw.ComboRow();
                const list = GjsifyOptionList.new([...vector.initial]);
                row.model = list;
                if (vector.selected >= 0) row.selected = vector.selected;
                expect(row.selected, 'the row set up the selection it says it did').toBe(vector.selected);

                const seen = watch(row);
                list.splice(vector.splice.position, vector.splice.removed, [...vector.splice.added]);

                expect(row.selected).toBe(vector.result);
                expect(row.selectedValue).toBe(vector.value);
                // A splice puts `selected-item` BEFORE `selected` — the inverse of a `selected`
                // write, and the reason this column is replayed rather than derived.
                expect(seen).toStrictEqual([...vector.notified]);
            });
        }
    });

    await describe('Adw.ComboRow model writes', async () => {
        await it('model = null notifies `model` ALONE while both derived values move', () => {
            // The measurement this port is held to (GJS 1.88 / libadwaita 1.9.4). It is also why
            // all three properties are `explicitNotify`: a store that notified on change would
            // emit three names here, and the widget would have no way to take two back.
            const row = new Adw.ComboRow();
            row.model = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            row.selected = 1;
            const seen = watch(row);

            row.model = null;
            expect(seen).toStrictEqual(['model']);
            expect(row.selected).toBe(ADW_COMBO_NO_SELECTION);
            expect(row.selectedItem).toBe(null);

            // ...and again is no change at all.
            seen.length = 0;
            row.model = null;
            expect(seen.length).toBe(0);
        });

        await it('a JSON attribute splices the held list in place, so the second write is silent', () => {
            // The markup door: `<adw:ComboRow model='[…]'>` is text, and `readModelWrite`
            // reconciles the row's own authored list and hands the SAME object back. The seam's
            // equal-write guard then stops the `model` notify, which is right — libadwaita
            // answers a re-assignment of the held model with nothing, and the splice has already
            // said what a splice says.
            const row = new Adw.ComboRow();
            loose(row).model = '[{"label":"One","value":"a"},{"label":"Two","value":"b"}]';
            const first = row.model;
            const seen = watch(row);

            loose(row).model = '[{"label":"One","value":"a"},{"label":"Three","value":"c"}]';
            expect(row.model).toBe(first);
            expect(seen.includes('model')).toBe(false);
            expect(row.options.map((o) => o.label)).toStrictEqual(['One', 'Three']);
        });

        await it('a child at the model slot goes through the same door as the property', () => {
            const row = new Adw.ComboRow();
            const list = GjsifyOptionList.new([{ label: 'One', value: 'a' }]);
            row._addChildFromBuilder('model', list as never);
            expect(row.model).toBe(list);
        });
    });

    await describe('Adw.ComboRow selected writes', async () => {
        await it('refuses an out-of-range index silently, the sentinel included', () => {
            // `ComboState.hasIndex` is the ONE bounds predicate, so a programmatic write and a
            // user pick refuse the same positions. Measured: GTK ignores the write, emits
            // nothing, and leaves the value standing.
            const row = new Adw.ComboRow();
            row.model = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            row.selected = 1;
            const seen = watch(row);
            row.selected = 7;
            row.selected = ADW_COMBO_NO_SELECTION;
            expect(row.selected).toBe(1);
            expect(seen.length).toBe(0);
        });

        await it('holds an index written before the model and applies it when one arrives', () => {
            // NativeScript's XML builder assigns every attribute before it adds the children, so
            // `selected="1"` reaches the row before `<adw:ComboRow.model>` does.
            const row = new Adw.ComboRow();
            row.selected = 1;
            expect(row.selected).toBe(ADW_COMBO_NO_SELECTION);
            row.model = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            expect(row.selected).toBe(1);
            expect(row.selectedValue).toBe('b');
        });

        await it('A/B: coerces an XML string to the declared int, and refuses what is neither', () => {
            // CONSUMER-VISIBLE: the hand-rolled setter fell back to the held value for a
            // non-numeric string. `readDeclaredValue` throws instead, like every other declared
            // scalar — a typo in markup is a typo and not a silent no-op.
            const row = new Adw.ComboRow();
            row.model = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            loose(row).selected = '1';
            expect(row.selected).toBe(1);
            expect(() => {
                loose(row).selected = 'second';
            }).toThrow();
            expect(row.selected).toBe(1);
        });
    });

    await describe('Adw.ComboRow selected-item', async () => {
        await it("is the model's OWN object, so an identity comparison holds", () => {
            const row = new Adw.ComboRow();
            const list = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            row.model = list;
            row.selected = 1;
            expect(row.selectedItem).toBe(list.get_item(1));
            expect(row.get_selected_item()).toBe(list.get_item(1));
        });

        await it('is read-only by derivation: a write changes nothing and notifies nothing', () => {
            // CONSUMER-VISIBLE: libadwaita THROWS on a write to a read-only property. The seam
            // has no read-only arm, and `normalize` resolving to the derived value is the
            // existing spelling for one (`AdwEntryRow:text-length`), so a write is a no-op here.
            const row = new Adw.ComboRow();
            row.model = GjsifyOptionList.new([{ label: 'One', value: 'a' }]);
            const held = row.selectedItem;
            const seen = watch(row);
            loose(row)['selected-item'] = { label: 'Spoofed', value: 'x' };
            expect(row.selectedItem).toBe(held);
            expect(seen.length).toBe(0);
        });
    });
};

export default AdwComboRowPropertiesNsTest;
