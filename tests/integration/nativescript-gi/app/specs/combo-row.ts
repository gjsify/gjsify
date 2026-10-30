// `Adw.ComboRow` ON A DEVICE (ADR 0105 § 2, route D): `model` and `selected-item` are declared
// OBJECT properties — the first of their kind on this port — and `selected` a declared int.
//
// All three are `explicitNotify` and therefore SEAM-OWNED (`isSeamOwned` in `widgets/signals.ts`):
// their value lives in the seam's store on both legs, not in the GObject, because every model this
// port holds is pure JS by construction (ADR 0122 § A3) and because the measured `notify::` order
// is not one a change-based store produces. What this file proves on the device is that the
// registration still happens — the GType carries the three pspecs, the accessor pair the seam
// installed answers in all three spellings, and the NativeScript door is shut — and that the
// orders `combo-row-properties.spec.ts` pins down off-device hold here too.
//
// Both legs run the same cases, so a difference is a defect in whichever engine disagrees.
// See `specs/split-button.ts` for the shape this copies.
import { Adw } from '@gjsify/adwaita-nativescript';
import { ADW_COMBO_NO_SELECTION, GjsifyOptionList } from '@gjsify/adwaita-core';

import { describe, expect, info, it } from '../reporter.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const AB = (): GjsifyOptionList =>
    GjsifyOptionList.new([
        { label: 'One', value: 'a' },
        { label: 'Two', value: 'b' },
    ]);

/** Record every `notify::` the row emits for a declared property, in order. */
const watch = (row: Adw.ComboRow): string[] => {
    const seen: string[] = [];
    for (const name of ['model', 'selected', 'selected-item']) {
        row.connect(`notify::${name}`, () => seen.push(name));
    }
    return seen;
};

export const comboRowSpec = (engine: 'real-gio' | 'pure-js') => async (): Promise<void> => {
    await describe(`Adw.ComboRow on '${engine}' (ADR 0105 § 2, route D)`, async () => {
        await it('starts at the C defaults', () => {
            const row = new Adw.ComboRow();
            expect(row.model).toBe(null);
            expect(row.selected).toBe(ADW_COMBO_NO_SELECTION);
            expect(row.selectedItem).toBe(null);
        });

        await it('holds the model BY IDENTITY, which is what an object property owes', () => {
            // The sharpest thing a device run can say about a `kind: 'object'` property: the
            // object that comes back is the one that went in. A real GObject slot could not do
            // this for a pure-JS list — `g_value_copy` refuses it — which is why the seam owns
            // the storage and node-gi never sees the value.
            const row = new Adw.ComboRow();
            const list = AB();
            row.model = list;
            expect(row.model === list).toBe(true);
            expect((row as Any)['selected-item'] === row.selectedItem).toBe(true);
            expect((row as Any).selected_item === row.selectedItem).toBe(true);
        });

        await it('notifies a model write in the measured order: selected, selected-item, model', () => {
            const row = new Adw.ComboRow();
            const seen = watch(row);
            row.model = AB();
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join()).toBe('selected,selected-item,model');
            expect(row.selected).toBe(0);
        });

        await it('notifies a selected write in the INVERSE order of a splice', () => {
            const row = new Adw.ComboRow();
            row.model = AB();
            const seen = watch(row);
            row.selected = 1;
            row.selected = 1;
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join()).toBe('selected,selected-item');
            expect(row.selectedValue).toBe('b');
        });

        await it('model = null notifies `model` alone while both derived values move', () => {
            // The case that made all three `explicitNotify`: GTK moves `selected` to the sentinel
            // and `selected-item` to null here and says NOTHING about either.
            const row = new Adw.ComboRow();
            row.model = AB();
            row.selected = 1;
            const seen = watch(row);
            row.model = null;
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join()).toBe('model');
            expect(row.selected).toBe(ADW_COMBO_NO_SELECTION);
            expect(row.selectedItem).toBe(null);
        });

        await it('a splice puts selected-item BEFORE selected', () => {
            const row = new Adw.ComboRow();
            const list = GjsifyOptionList.new([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
                { label: 'Three', value: 'c' },
            ]);
            row.model = list;
            row.selected = 2;
            const seen = watch(row);
            list.splice(2, 1, []);
            info(`seen=[${seen.join(',')}]`);
            expect(seen.join()).toBe('selected-item,selected');
            expect(row.selected).toBe(1);
        });

        await it('refuses an out-of-range index silently, and coerces an XML string', () => {
            const row = new Adw.ComboRow();
            row.model = AB();
            row.selected = 1;
            const seen = watch(row);
            row.selected = 7;
            expect(row.selected).toBe(1);
            expect(seen.length).toBe(0);
            (row as Any).selected = '0';
            expect(row.selected).toBe(0);
        });

        await it('selected-item is read-only by derivation: a write changes nothing', () => {
            const row = new Adw.ComboRow();
            row.model = AB();
            const held = row.selectedItem;
            (row as Any)['selected-item'] = { label: 'Spoofed', value: 'x' };
            expect(row.selectedItem === held).toBe(true);
        });

        await it('the declared properties are not reachable through the NativeScript door', () => {
            const row = new Adw.ComboRow();
            for (const name of ['model', 'selected', 'selected-item']) {
                expect(() => (row as Any).notify({ eventName: `notify::${name}`, object: row })).toThrow();
            }
        });
    });
};

export default comboRowSpec;
