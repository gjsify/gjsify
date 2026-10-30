// `Gtk.DropDown`'S `model` / `selected` / `selected-item` AS DECLARED GObject MEMBERS, measured
// on the pure-JS leg (ADR 0105 § 2, route D).
//
// The TWIN of `combo-row-properties.spec.ts`, and deliberately so: the two widgets are one
// selection (`ComboState`) behind two renderers, and their three declarations are verbatim
// copies. A copy that drifts is only caught if both copies are replayed against the SAME
// conformance table, so both vector suites run here a second time rather than being trusted to
// the row.
//
// What is NOT a copy — the cases below the vectors — is where the drop-down differs from the
// row: it holds a `selected` written before its model (new here, the row already did), it takes
// no child but a model, and it carries the chooser-sheet title the row has no place for.
//
// WHY THIS FILE EXISTS BESIDE `drop-down.spec.ts`: that one drives `ComboState` directly, from
// the non-trees entry, because the widget could not be imported there at all. This one drives
// the WIDGET through the property surface a consumer has.
//
// This lives on the TREES entry (`src/test.trees.mts`): `extends StackLayout` reaches
// `@nativescript/core` at module scope, resolvable only under that entry's `--alias`.

import { describe, expect, it } from '@gjsify/unit';

import { ADW_COMBO_NO_SELECTION, GjsifyOptionList } from '@gjsify/adwaita-core';
import type { ComboNotify, ComboState } from '@gjsify/adwaita-core';
import {
    COMBO_ITEMS_CHANGED_VECTORS,
    COMBO_SELECTION_VECTORS,
    type ComboSelectionStep,
} from '@gjsify/adwaita-core/conformance';

import * as Gtk from './namespace/gtk.js';
import { emittedSignalsOf } from './widgets/signals.js';

/** The three names, canonical spelling, as the pspecs declare them. */
const DECLARED: readonly ComboNotify[] = ['model', 'selected', 'selected-item'];

const loose = (down: Gtk.DropDown): Record<string, unknown> => down as unknown as Record<string, unknown>;

/**
 * The chooser pick, without the sheet. `_openChooser` awaits a native `action()` and then calls
 * `ComboState.select`; the sheet is the platform's and the selection is ours, so this reaches the
 * second half directly.
 */
const pick = (down: Gtk.DropDown, index: number): void => {
    (down as unknown as { _state: ComboState })._state.select(index);
};

/** Record every `notify::` the drop-down emits for a declared property, in order. */
function watch(down: Gtk.DropDown): ComboNotify[] {
    const seen: ComboNotify[] = [];
    for (const name of DECLARED) down.connect(`notify::${name}`, () => seen.push(name));
    return seen;
}

/** Replay one combo vector step against the WIDGET — the row's `applyStep`, on the other renderer. */
function applyStep(down: Gtk.DropDown, step: ComboSelectionStep): void {
    switch (step.op) {
        case 'setModel':
            down.model = GjsifyOptionList.new([...step.model]);
            return;
        case 'setModelAgain': {
            // The held object written BACK; through a local for the reason the row's file states.
            const held = down.model;
            down.model = held;
            return;
        }
        case 'setSelectedIndex':
            down.selected = step.index;
            return;
        case 'setSelectedValue':
            down.selectedValue = step.value;
            return;
        case 'select':
            pick(down, step.index);
            return;
    }
}

export const GtkDropDownPropertiesNsTest = async () => {
    await describe('Gtk.DropDown: model, selected and selected-item are declared properties', async () => {
        await it("starts at gtk_drop_down_init's defaults, having emitted nothing", () => {
            const down = new Gtk.DropDown();
            const seen = watch(down);
            expect(down.model).toBe(null);
            expect(down.selected).toBe(ADW_COMBO_NO_SELECTION);
            expect(down.selectedItem).toBe(null);
            expect(seen.length).toBe(0);
        });

        await it('answers each property in all three GObject spellings', () => {
            const down = new Gtk.DropDown();
            const list = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            down.model = list;
            down.selected = 1;
            const props = loose(down);
            expect(props.model).toBe(list);
            expect(props.selected).toBe(1);
            expect(props['selected-item']).toBe(down.selectedItem);
            expect(props.selected_item).toBe(down.selectedItem);
        });

        await it('declares one notify:: per property, merged with what every widget emits', () => {
            // The hand-rolled `static emittedSignals` is gone; the list is the seam's, so the
            // builder can connect `notify::model` — which the hand-rolled list never offered.
            const signals = emittedSignalsOf(Gtk.DropDown);
            expect(signals.join()).toBe('map,unmap,notify::model,notify::selected,notify::selected-item');
        });

        await it('is GObject-only: notify() refuses the declared names by payload', () => {
            // CONSUMER-VISIBLE: `notify::selected` used to be a NativeScript event carrying
            // `NotifyDropDownSelectedEventData` (`{ selected, value, label }`). That interface is
            // deleted and dispatching such an event throws, rather than quietly reaching no
            // GObject handler.
            const down = new Gtk.DropDown();
            for (const name of DECLARED) {
                expect(() => down.notify({ eventName: `notify::${name}`, object: down as never })).toThrow();
            }
        });
    });

    await describe('Gtk.DropDown notify order (libadwaita conformance vectors)', async () => {
        for (const vector of COMBO_SELECTION_VECTORS) {
            await it(`notifies in order through: ${vector.name}`, () => {
                const down = new Gtk.DropDown();
                const seen = watch(down);

                for (const step of vector.steps) applyStep(down, step);

                expect(down.selected).toBe(vector.selected);
                expect(down.selectedValue).toBe(vector.value);
                // The same column the row is held to. The two renderers share one state machine,
                // so a difference here is a difference between the two DECLARATIONS.
                expect(seen).toStrictEqual([...vector.notified]);
            });
        }

        await it('a programmatic write notifies — the `interactive` carve-out is gone here', () => {
            const down = new Gtk.DropDown();
            down.model = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            const seen = watch(down);
            down.selected = 1;
            expect(seen).toStrictEqual(['selected', 'selected-item']);
            seen.length = 0;
            pick(down, 0);
            expect(seen).toStrictEqual(['selected', 'selected-item']);
        });

        await it('paints the button label off the change it was handed', () => {
            // The one thing the row's file cannot cover: this renderer's whole output is the
            // button label, and it is painted from `change.label` — so replacing the model at an
            // unchanged index repaints rather than keeping the old option's text.
            const down = new Gtk.DropDown();
            const label = () => (down as unknown as { _label: { text: string } })._label.text;
            down.model = GjsifyOptionList.new([{ label: 'First', value: 'a' }]);
            down.selected = 0;
            expect(label()).toBe('First');
            down.model = GjsifyOptionList.new([{ label: 'Renamed', value: 'a' }]);
            expect(label()).toBe('Renamed');
        });
    });

    await describe('Gtk.DropDown items-changed (shared conformance vectors)', async () => {
        for (const vector of COMBO_ITEMS_CHANGED_VECTORS) {
            await it(`notifies through: ${vector.name}`, () => {
                const down = new Gtk.DropDown();
                const list = GjsifyOptionList.new([...vector.initial]);
                down.model = list;
                if (vector.selected >= 0) down.selected = vector.selected;
                expect(down.selected, 'the drop-down set up the selection it says it did').toBe(vector.selected);

                const seen = watch(down);
                list.splice(vector.splice.position, vector.splice.removed, [...vector.splice.added]);

                expect(down.selected).toBe(vector.result);
                expect(down.selectedValue).toBe(vector.value);
                expect(seen).toStrictEqual([...vector.notified]);
            });
        }
    });

    await describe('Gtk.DropDown model writes', async () => {
        await it('model = null notifies `model` ALONE while both derived values move', () => {
            const down = new Gtk.DropDown();
            down.model = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            down.selected = 1;
            const seen = watch(down);

            down.model = null;
            expect(seen).toStrictEqual(['model']);
            expect(down.selected).toBe(ADW_COMBO_NO_SELECTION);
            expect(down.selectedItem).toBe(null);

            seen.length = 0;
            down.model = null;
            expect(seen.length).toBe(0);
        });

        await it('a JSON attribute splices the held list in place, so the second write is silent', () => {
            const down = new Gtk.DropDown();
            loose(down).model = '[{"label":"One","value":"a"},{"label":"Two","value":"b"}]';
            const first = down.model;
            const seen = watch(down);

            loose(down).model = '[{"label":"One","value":"a"},{"label":"Three","value":"c"}]';
            expect(down.model).toBe(first);
            expect(seen.includes('model')).toBe(false);
            expect(down.options.map((o) => o.label)).toStrictEqual(['One', 'Three']);
        });

        await it('takes a child at the model slot and refuses any other, as GTK does', () => {
            const down = new Gtk.DropDown();
            const list = GjsifyOptionList.new([{ label: 'One', value: 'a' }]);
            down._addChildFromBuilder('model', list as never);
            expect(down.model).toBe(list);
            expect(() => down._addChildFromBuilder('child', list as never)).toThrow();
        });
    });

    await describe('Gtk.DropDown selected writes', async () => {
        await it('refuses an out-of-range index silently, the sentinel included', () => {
            const down = new Gtk.DropDown();
            down.model = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            down.selected = 1;
            const seen = watch(down);
            down.selected = 7;
            down.selected = ADW_COMBO_NO_SELECTION;
            expect(down.selected).toBe(1);
            expect(seen.length).toBe(0);
        });

        await it('holds an index written before the model and applies it when one arrives', () => {
            // CONSUMER-VISIBLE, and the drop-down's own bug fix: NativeScript's XML builder
            // assigns every attribute before it adds the children, so `selected="1"` reached this
            // widget before `<gtk:DropDown.model>` did and the index was DROPPED. The row has
            // held it since it was written; this one does now too.
            const down = new Gtk.DropDown();
            down.selected = 1;
            expect(down.selected).toBe(ADW_COMBO_NO_SELECTION);
            down.model = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            expect(down.selected).toBe(1);
            expect(down.selectedValue).toBe('b');
        });

        await it('A/B: coerces an XML string to the declared int, and refuses what is neither', () => {
            // CONSUMER-VISIBLE: the hand-rolled setter fell back to the held value for a
            // non-numeric string. `readDeclaredValue` throws instead, like every other declared
            // scalar.
            const down = new Gtk.DropDown();
            down.model = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            loose(down).selected = '1';
            expect(down.selected).toBe(1);
            expect(() => {
                loose(down).selected = 'second';
            }).toThrow();
            expect(down.selected).toBe(1);
        });

        await it('reaches the same values through the gtk_drop_down_* method names', () => {
            const down = new Gtk.DropDown();
            const list = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            down.set_model(list);
            down.set_selected(1);
            expect(down.get_model()).toBe(list);
            expect(down.get_selected()).toBe(1);
            expect(down.get_selected_item()).toBe(list.get_item(1));
        });
    });

    await describe('Gtk.DropDown selected-item', async () => {
        await it("is the model's OWN object, so an identity comparison holds", () => {
            const down = new Gtk.DropDown();
            const list = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            down.model = list;
            down.selected = 1;
            expect(down.selectedItem).toBe(list.get_item(1));
        });

        await it('is read-only by derivation: a write changes nothing and notifies nothing', () => {
            // CONSUMER-VISIBLE: libadwaita THROWS on a write to a read-only property; the seam
            // has no read-only arm, so `normalize` resolving to the derived value makes the write
            // a no-op instead (`AdwEntryRow:text-length` is the existing spelling).
            const down = new Gtk.DropDown();
            down.model = GjsifyOptionList.new([{ label: 'One', value: 'a' }]);
            const held = down.selectedItem;
            const seen = watch(down);
            loose(down)['selected-item'] = { label: 'Spoofed', value: 'x' };
            expect(down.selectedItem).toBe(held);
            expect(seen.length).toBe(0);
        });
    });
};

export default GtkDropDownPropertiesNsTest;
