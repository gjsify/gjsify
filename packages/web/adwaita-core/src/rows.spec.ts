// The row state machines (ADR 0004): the full clamp/step-edge, empty/out-of-range,
// index↔value-sync, toggle-idempotence and notify-only-on-change matrix.
//
// `ComboState`'s scenario matrix lives in `COMBO_SELECTION_VECTORS` (conformance/rows.ts)
// instead, driven below and by both renderer suites, so a divergence fails a test naming
// the input rather than three suites agreeing by luck.

import { describe, it, expect } from '@gjsify/unit';

import {
    ADW_COMBO_NO_SELECTION,
    ComboState,
    ExpanderState,
    ToggleGroupState,
    keptToggles,
    normalizeComboOptions,
    toggleIndexOfName,
} from './rows.js';
import type { ComboNotify, ComboStateChange, ToggleGroupStateChange } from './rows.js';
import {
    COMBO_CHOOSER_VECTORS,
    COMBO_ITEMS_CHANGED_VECTORS,
    COMBO_SELECTION_VECTORS,
    TOGGLE_ACTIVE_NAME_VECTORS,
} from './conformance/rows.js';
import type { ComboSelectionStep } from './conformance/rows.js';
import { LIST_MODEL_OWNERSHIP_VECTORS, applyListMutation, applyListReadback } from './conformance/list.js';
import { GjsifyOptionList } from './option-list.js';
import type { AdwComboOption, AdwListItemsChanged } from './list.js';

/**
 * Replay one combo vector step against a headless combo state.
 *
 * Every `setModel` builds a FRESH list, which is what makes `setModelAgain` a distinct step
 * rather than a repeat of the one before it: `model` holds an object now (ADR 0122 § 4), so
 * two lists with equal contents are two different values and only the second step hands back
 * the identity the state is already on.
 */
function applyComboStep(state: ComboState, step: ComboSelectionStep): void {
    switch (step.op) {
        case 'setModel':
            state.setModel(GjsifyOptionList.new([...step.model]));
            return;
        case 'setModelAgain':
            state.setModel(state.model);
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

export default async () => {
    await describe('ExpanderState disclosure (Adw.ExpanderRow)', async () => {
        await it('starts collapsed', () => {
            expect(new ExpanderState().expanded).toBe(false);
        });

        await it('toggle flips expanded and notifies each change', () => {
            const state = new ExpanderState();
            const seen: boolean[] = [];
            state.subscribe((expanded) => seen.push(expanded));

            expect(state.toggle()).toBe(true);
            expect(state.expanded).toBe(true);
            expect(state.toggle()).toBe(true);
            expect(state.expanded).toBe(false);
            expect(seen).toStrictEqual([true, false]);
        });

        await it('setExpanded is idempotent — no notify when already in that state', () => {
            const state = new ExpanderState();
            const seen: boolean[] = [];
            state.subscribe((expanded) => seen.push(expanded));

            expect(state.collapse()).toBe(false); // already collapsed
            expect(state.expand()).toBe(true);
            expect(state.expand()).toBe(false); // already expanded → no-op
            expect(state.setExpanded(true)).toBe(false);
            expect(seen).toStrictEqual([true]); // only the one real transition fired
        });

        await it('coerces truthy/falsy values to a boolean', () => {
            const state = new ExpanderState();
            expect(state.setExpanded(1 as unknown as boolean)).toBe(true);
            expect(state.expanded).toBe(true);
            expect(state.setExpanded(0 as unknown as boolean)).toBe(true);
            expect(state.expanded).toBe(false);
        });

        await it('unsubscribe stops further notifications', () => {
            const state = new ExpanderState();
            const seen: boolean[] = [];
            const off = state.subscribe((expanded) => seen.push(expanded));
            state.toggle();
            off();
            state.toggle();
            expect(seen).toStrictEqual([true]);
        });
    });

    await describe('ComboState selection (libadwaita conformance vectors)', async () => {
        for (const vector of COMBO_SELECTION_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const state = new ComboState();
                const changes: ComboStateChange[] = [];
                const notified: ComboNotify[] = [];
                state.subscribe((change) => changes.push(change));
                state.subscribeNotify((property) => notified.push(property));

                for (const step of vector.steps) applyComboStep(state, step);

                expect(state.selectedIndex).toBe(vector.selected);
                expect(state.selectedValue).toBe(vector.value);
                expect(state.selectedLabel).toBe(vector.label);
                // The whole feed, not just its last frame: a renderer repaints from every
                // change, so a swallowed or duplicated one is a bug even when the end
                // state is right.
                expect(changes).toStrictEqual([...vector.emitted]);
                // And the `notify::` ORDER beside it, which is the half a DOM renderer has
                // no way to show: the two feeds disagree on purpose (a model write emits ONE
                // change and three notifies), so neither stands in for the other.
                expect(notified).toStrictEqual([...vector.notified]);
            });
        }
    });

    await describe('ComboState items-changed on the held model (GtkSingleSelection)', async () => {
        for (const vector of COMBO_ITEMS_CHANGED_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const state = new ComboState();
                const list = GjsifyOptionList.new([...vector.initial]);
                state.setModel(list);
                if (vector.selected >= 0) state.setSelectedIndex(vector.selected);
                expect(state.selectedIndex, 'the row set up the selection it says it did').toBe(vector.selected);

                const splices: AdwListItemsChanged[] = [];
                const notified: ComboNotify[] = [];
                state.subscribeItems((change) => splices.push(change));
                state.subscribeNotify((property) => notified.push(property));

                list.splice(vector.splice.position, vector.splice.removed, [...vector.splice.added]);

                expect(state.selectedIndex).toBe(vector.result);
                expect(state.selectedValue).toBe(vector.value);
                expect(notified).toStrictEqual([...vector.notified]);
                // The splice reaches the renderer channel on EVERY row, including the ones
                // that notify nothing: where the list changed is a fact about the drawn
                // items, independent of whether the selection moved with it.
                expect(splices).toStrictEqual([
                    {
                        position: vector.splice.position,
                        removed: vector.splice.removed,
                        added: vector.splice.added.length,
                    },
                ]);
            });
        }
    });

    // WHO OWNS THE OPTIONS — the two arrays either side of the model, and the model itself.
    // Driven here rather than only at the renderers because this is the surface where the
    // state takes a list straight from a caller: an element setter builds the list out of
    // its own parsed attribute and so closes the input door on its own.
    await describe('ComboState model ownership (portable list-model vectors)', async () => {
        for (const vector of LIST_MODEL_OWNERSHIP_VECTORS) {
            await it(vector.rule, () => {
                const state = new ComboState();
                // A caller's own array of a caller's own items, which is what makes the row
                // about ownership rather than about the table's constants.
                const input: AdwComboOption[] = vector.initial.map((item) => ({ ...item }));
                const list = GjsifyOptionList.new(input);
                state.setModel(list);

                const splices: AdwListItemsChanged[] = [];
                state.subscribeItems((change) => splices.push(change));

                if (vector.source === 'model') applyListMutation(list, vector.op);
                else applyListReadback(vector.source === 'input' ? input : state.options, vector.op);

                expect(state.options).toStrictEqual([...vector.model]);
                expect(splices).toStrictEqual(vector.itemsChanged === null ? [] : [vector.itemsChanged]);
                // The model the state holds is still the one it was handed: none of these
                // ops is a replacement, so identity must not have moved under any of them.
                expect(state.model).toBe(list);
            });
        }
    });

    // What the vectors do NOT carry: every mutator's "did it change" return value, which
    // is what each renderer gates its `notify::*` re-emit on, plus the guards that have no
    // scenario of their own.
    await describe('ComboState selection contract (Adw.ComboRow)', async () => {
        const twoOptions = (): ComboState => {
            const state = new ComboState();
            state.setModel(
                GjsifyOptionList.new([
                    { label: 'One', value: 'a' },
                    { label: 'Two', value: 'b' },
                ]),
            );
            return state;
        };

        await it('setSelectedValue moves the index to the matching option', () => {
            const state = twoOptions();
            expect(state.setSelectedValue('b')).toBe(true);
            expect(state.selectedIndex).toBe(1);
            // Unknown value is a no-op — index stays put.
            expect(state.setSelectedValue('nope')).toBe(false);
            expect(state.selectedIndex).toBe(1);
        });

        await it('guards an empty options list', () => {
            const state = new ComboState();
            state.setModel(GjsifyOptionList.new([]));
            expect(state.count).toBe(0);
            expect(state.selectedValue).toBe('');
            expect(state.select(0)).toBe(false); // nothing to interactively pick
            // GTK_INVALID_LIST_POSITION, not index 0 — an empty model and a model whose
            // first label is empty are different states.
            expect(state.selectedIndex).toBe(ADW_COMBO_NO_SELECTION);
        });

        await it('presentsChooser follows model_changed — one option is not a choice', () => {
            const state = new ComboState();
            for (const { count, presentsChooser, rule } of COMBO_CHOOSER_VECTORS) {
                state.setModel(
                    GjsifyOptionList.new(Array.from({ length: count }, (_, i) => ({ label: `L${i}`, value: `v${i}` }))),
                );
                expect(state.presentsChooser, rule).toBe(presentsChooser);
            }
        });

        await it('setSelectedIndex returns whether it changed', () => {
            // The return IS the notify gate: `<gtk-drop-down>` fires `notify::selected`
            // off it rather than keeping a second copy of the index to compare.
            const state = twoOptions();
            expect(state.setSelectedIndex(1)).toBe(true);
            expect(state.setSelectedIndex(1)).toBe(false); // already there → no-op
        });

        await it('select returns whether it changed and guards the no-op pick', () => {
            const state = twoOptions();
            expect(state.select(1)).toBe(true);
            expect(state.select(1)).toBe(false); // already selected → no-op
            expect(state.select(-1)).toBe(false); // negative → no-op
        });

        await it('an interactive select cannot pick past the end either', () => {
            // A pick is a pick OF something. Only the negative half used to be
            // guarded, so `select(99)` moved the index somewhere selectedValue
            // calls "no selection" — an interactive path reaching a state the
            // chooser has no row for.
            const state = twoOptions();
            const changes: ComboStateChange[] = [];
            state.subscribe((c) => changes.push(c));
            expect(state.select(2)).toBe(false); // one past the end
            expect(state.select(99)).toBe(false);
            expect(state.select(Number.NaN)).toBe(false);
            expect(state.selectedIndex).toBe(0);
            expect(changes.length).toBe(0);
        });

        await it('hasIndex is the gate BOTH paths now pass through', () => {
            const state = twoOptions();
            expect(state.hasIndex(0)).toBe(true);
            expect(state.hasIndex(1)).toBe(true);
            expect(state.hasIndex(2)).toBe(false);
            expect(state.hasIndex(-1)).toBe(false);
            expect(state.hasIndex(Number.NaN)).toBe(false);
            expect(state.hasIndex(Number.POSITIVE_INFINITY)).toBe(false);
            // There is no permissive programmatic half any more (ADR 0122 § 4, measured
            // against libadwaita 1.9.4): `Adw.ComboRow` and `Gtk.DropDown` IGNORE a
            // `selected` write for a position the model does not have, silently and with
            // no notify, so a position `hasIndex` rejects cannot be reached from here
            // either and the selection standing stays.
            expect(state.setSelectedIndex(1)).toBe(true);
            expect(state.setSelectedIndex(5)).toBe(false);
            expect(state.selectedIndex).toBe(1);
            expect(state.setSelectedIndex(ADW_COMBO_NO_SELECTION)).toBe(false);
            expect(state.selectedIndex).toBe(1);
        });

        await it('normalizeComboOptions takes strings, descriptors and half-descriptors', () => {
            expect(normalizeComboOptions(['One', 'Two'])).toStrictEqual([
                { value: 'One', label: 'One' },
                { value: 'Two', label: 'Two' },
            ]);
            expect(normalizeComboOptions([{ value: 'a', label: 'Apple' }])).toStrictEqual([
                { value: 'a', label: 'Apple' },
            ]);
            // Either half stands in for the missing other, so a label-only entry
            // stays addressable by value instead of becoming `undefined`.
            expect(normalizeComboOptions([{ label: 'Apple' }])).toStrictEqual([{ value: 'Apple', label: 'Apple' }]);
            expect(normalizeComboOptions([{ value: 'a' }])).toStrictEqual([{ value: 'a', label: 'a' }]);
            // Non-strings are coerced, not dropped — the JSON attribute path can
            // deliver numbers.
            expect(normalizeComboOptions([{ value: 7, label: 7 }])).toStrictEqual([{ value: '7', label: '7' }]);
            // A neither-half entry is the empty option, not a crash.
            expect(normalizeComboOptions([{}])).toStrictEqual([{ value: '', label: '' }]);
        });

        await it('normalizeComboOptions guards a non-array', () => {
            expect(normalizeComboOptions(null)).toStrictEqual([]);
            expect(normalizeComboOptions(undefined)).toStrictEqual([]);
            expect(normalizeComboOptions({ length: 2 } as unknown as string[])).toStrictEqual([]);
        });

        await it('ignores a non-finite programmatic index instead of folding it to 0', () => {
            // It used to coerce, which turned a `parseInt` of a malformed attribute into a
            // real selection change at index 0. A non-finite position addresses no item, so
            // it fails `hasIndex` like any other and the write is dropped.
            const state = twoOptions();
            state.setSelectedIndex(1);
            expect(state.setSelectedIndex(Number.NaN)).toBe(false);
            expect(state.setSelectedIndex(Number.POSITIVE_INFINITY)).toBe(false);
            expect(state.selectedIndex).toBe(1);
        });
    });

    await describe('keptToggles + toggleIndexOfName (Adw.ToggleGroup:active-name)', async () => {
        for (const vector of TOGGLE_ACTIVE_NAME_VECTORS) {
            await it(vector.rule, () => {
                const kept = keptToggles(vector.names.map((name) => ({ name })));
                expect(kept.length).toBe(vector.kept);
                expect(
                    toggleIndexOfName(
                        kept.map((toggle) => toggle.name),
                        vector.activeName,
                    ),
                ).toBe(vector.index);
            });
        }
    });

    await describe('ToggleGroupState segmented selection (Adw.ToggleGroup)', async () => {
        const days = (): ToggleGroupState => {
            const state = new ToggleGroupState();
            state.setLabels(['Day', 'Week', 'Month']);
            return state;
        };

        await it('resolves selectedValue from the label list', () => {
            const state = days();
            state.setSelected(2);
            expect(state.selected).toBe(2);
            expect(state.selectedValue).toBe('Month');
        });

        await it('starts on the first segment', () => {
            expect(days().selectedValue).toBe('Day');
        });

        await it('guards out-of-range, negative and no-op selections', () => {
            const state = days();
            const changes: ToggleGroupStateChange[] = [];
            state.subscribe((c) => changes.push(c));

            expect(state.setSelected(5)).toBe(false); // past the end
            expect(state.setSelected(-1)).toBe(false); // negative
            expect(state.setSelected(0)).toBe(false); // already selected
            expect(state.selected).toBe(0);
            expect(changes).toStrictEqual([]); // nothing fired

            expect(state.setSelected(1)).toBe(true);
            expect(changes).toStrictEqual([{ selected: 1, value: 'Week' }]);
        });

        await it('returns empty string when the selection sits past an empty/short list', () => {
            const state = new ToggleGroupState();
            state.setLabels(['Day']);
            state.setSelected(5); // guarded no-op — stays at 0
            expect(state.selectedValue).toBe('Day');
            state.setLabels([]);
            expect(state.selectedValue).toBe('');
        });

        await it('setLabels resets the selection to 0 when it no longer fits — silently', () => {
            const state = days();
            const changes: ToggleGroupStateChange[] = [];
            state.setSelected(2);
            state.subscribe((c) => changes.push(c));
            state.setLabels(['Solo']); // index 2 no longer valid
            expect(state.selected).toBe(0);
            expect(state.selectedValue).toBe('Solo');
            expect(changes).toStrictEqual([]); // setLabels never notifies
        });

        await it('coerces a non-finite selection to 0 (a no-op when already there)', () => {
            const state = days();
            expect(state.setSelected(Number.NaN)).toBe(false); // → 0, already selected
            state.setSelected(1);
            expect(state.setSelected(Number.NaN)).toBe(true); // → 0, real change
            expect(state.selected).toBe(0);
        });
    });
};
