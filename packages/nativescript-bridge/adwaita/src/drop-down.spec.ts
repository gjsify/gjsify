// GtkDropDown's selection, against the shared conformance table.
//
// The widget itself cannot be imported here — `GtkDropDown extends StackLayout`
// evaluates the bare `@nativescript/core` specifier at module-eval, which is
// unresolvable on GJS/Node. It needs no pure sibling either, because it holds no
// logic to extract: `ComboState` (`@gjsify/adwaita-core`) IS the selection, and
// the widget is three lines of wiring on top of it — the label is painted from
// `change.label` and `notify::selected` is re-emitted when `change.interactive`.
//
// So what is driven here is the state machine, through
// `COMBO_SELECTION_VECTORS`: the emission stream each vector pins down IS the
// widget's input feed, and the final `label` IS what the button shows. The
// alternative — a stand-in class respelling the subscriber — would only ever
// confirm that the stand-in agrees with itself, which is exactly the mock this
// package deleted for the switch row after it had been green while encoding the
// wrong rule.
//
// The same table holds `AdwComboRow`, whose selection is the same object; the
// two surfaces cannot drift apart without one of them failing a row here.

import { describe, expect, it } from '@gjsify/unit';

import { ComboState } from '@gjsify/adwaita-core';
import type { ComboStateChange } from '@gjsify/adwaita-core';
import { COMBO_SELECTION_VECTORS, type ComboSelectionStep } from '@gjsify/adwaita-core/conformance';

function applyStep(state: ComboState, step: ComboSelectionStep): void {
    switch (step.op) {
        case 'setModel':
            state.setModel([...step.model]);
            return;
        case 'setSelectedIndex':
            state.setSelectedIndex(step.index);
            return;
        case 'setSelectedValue':
            state.setSelectedValue(step.value);
            return;
        case 'select':
            state.select(step.index);
            return;
    }
}

export const AdwDropDownNsTest = async () => {
    await describe('GtkDropDown selection (libadwaita conformance vectors)', async () => {
        for (const vector of COMBO_SELECTION_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const state = new ComboState();
                const changes: ComboStateChange[] = [];
                state.subscribe((change) => changes.push(change));

                for (const step of vector.steps) applyStep(state, step);

                expect(state.selectedIndex).toBe(vector.selected);
                expect(state.selectedValue).toBe(vector.value);
                expect(state.selectedLabel).toBe(vector.label);
                // The whole feed, not just its last frame: a renderer repaints
                // from every change, so a swallowed or duplicated one is a bug
                // even when the end state is right.
                expect(changes).toStrictEqual([...vector.emitted]);
            });
        }

        await it('paints the label off the change, never off the index', () => {
            // What the button shows is `change.label`. Reading the options array
            // at `selected` instead would print the OLD label for the frame in
            // which the model is replaced at an unchanged index.
            const state = new ComboState();
            const painted: string[] = [];
            state.subscribe((change) => painted.push(change.label));

            state.setModel([{ label: 'First', value: 'a' }]);
            state.setModel([{ label: 'Renamed', value: 'a' }]);
            expect(painted).toStrictEqual(['First', 'Renamed']);
        });

        await it('re-emits notify::selected only for the chooser pick', () => {
            // The `interactive` gate, isolated: it is what separates the two
            // surfaces' user path from their programmatic one — and it is the
            // ports' rule, not GTK's (conformance/rows.ts states why).
            const state = new ComboState();
            const notified: number[] = [];
            state.subscribe((change) => {
                if (change.interactive) notified.push(change.selected);
            });

            state.setModel([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            state.setSelectedIndex(1); // programmatic — silent
            state.select(0); // the pick — notifies
            state.setSelectedValue('b'); // programmatic — silent
            expect(notified).toStrictEqual([0]);
        });

        await it('has nothing to open over an empty model', () => {
            // `_openChooser` returns before presenting a sheet when `count` is 0,
            // which is the only guard the widget carries that the vectors above
            // cannot see (they end at the state, the sheet is the platform's).
            const state = new ComboState();
            expect(state.count).toBe(0);
            state.setModel([{ label: 'One', value: 'a' }]);
            expect(state.count).toBe(1);
        });
    });
};

export default AdwDropDownNsTest;
