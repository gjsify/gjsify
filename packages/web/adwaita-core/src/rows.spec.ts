// Ported from `@gjsify/adwaita-nativescript`'s index.spec.ts alongside the row
// state-machine move (ADR 0004) — the NS package keeps only the widget render and
// pins the moved surface with re-export smoke specs. Extended here with the full
// clamp/step-edge, empty/out-of-range, index↔value-sync, toggle-idempotence and
// notify-only-on-change matrix the NS mocks could not exercise.

import { describe, it, expect } from '@gjsify/unit';

import { ComboState, ExpanderState, SpinState, ToggleGroupState, normalizeComboOptions } from './rows.js';
import type { ComboStateChange, SpinStateChange, ToggleGroupStateChange } from './rows.js';

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

    await describe('ComboState selection (Adw.ComboRow)', async () => {
        const twoOptions = (): ComboState => {
            const state = new ComboState();
            state.setOptions([
                { label: 'One', value: 'a' },
                { label: 'Two', value: 'b' },
            ]);
            return state;
        };

        await it('resolves selectedValue/selectedLabel from selectedIndex', () => {
            const state = twoOptions();
            state.setSelectedIndex(1);
            expect(state.selectedIndex).toBe(1);
            expect(state.selectedValue).toBe('b');
            expect(state.selectedLabel).toBe('Two');
        });

        await it('setSelectedValue moves the index to the matching option', () => {
            const state = twoOptions();
            expect(state.setSelectedValue('b')).toBe(true);
            expect(state.selectedIndex).toBe(1);
            // Unknown value is a no-op — index stays put.
            expect(state.setSelectedValue('nope')).toBe(false);
            expect(state.selectedIndex).toBe(1);
        });

        await it('returns empty strings for an out-of-range index', () => {
            const state = new ComboState();
            state.setOptions([{ label: 'One', value: 'a' }]);
            state.setSelectedIndex(5);
            expect(state.selectedValue).toBe('');
            expect(state.selectedLabel).toBe('');
        });

        await it('guards an empty options list', () => {
            const state = new ComboState();
            state.setOptions([]);
            expect(state.count).toBe(0);
            expect(state.selectedValue).toBe('');
            expect(state.select(0)).toBe(false); // nothing to interactively pick
            expect(state.selectedIndex).toBe(0);
        });

        await it('setOptions resets the index to 0 when it no longer fits', () => {
            const state = twoOptions();
            state.setSelectedIndex(1);
            state.setOptions([{ label: 'Only', value: 'x' }]); // index 1 no longer valid
            expect(state.selectedIndex).toBe(0);
            expect(state.selectedValue).toBe('x');
        });

        await it('setOptions re-syncs the label even at the same index (interactive:false)', () => {
            const state = new ComboState();
            state.setOptions([{ label: 'First', value: 'a' }]);
            const changes: ComboStateChange[] = [];
            state.subscribe((c) => changes.push(c));
            state.setOptions([{ label: 'Renamed', value: 'a' }]); // same index 0, new label
            expect(state.selectedLabel).toBe('Renamed');
            expect(changes[changes.length - 1]).toStrictEqual({
                selected: 0,
                value: 'a',
                label: 'Renamed',
                interactive: false,
            });
        });

        await it('a programmatic index set notifies interactive:false', () => {
            const state = twoOptions();
            const changes: ComboStateChange[] = [];
            state.subscribe((c) => changes.push(c));
            expect(state.setSelectedIndex(1)).toBe(true);
            expect(changes).toStrictEqual([{ selected: 1, value: 'b', label: 'Two', interactive: false }]);
            // Setting the same index again does not notify.
            expect(state.setSelectedIndex(1)).toBe(false);
            expect(changes.length).toBe(1);
        });

        await it('an interactive select notifies interactive:true and guards the no-op pick', () => {
            const state = twoOptions();
            const changes: ComboStateChange[] = [];
            state.subscribe((c) => changes.push(c));
            expect(state.select(1)).toBe(true);
            expect(changes).toStrictEqual([{ selected: 1, value: 'b', label: 'Two', interactive: true }]);
            expect(state.select(1)).toBe(false); // already selected → no-op
            expect(state.select(-1)).toBe(false); // negative → no-op
            expect(changes.length).toBe(1);
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

        await it('hasIndex answers the bounds question both renderers ask', () => {
            const state = twoOptions();
            expect(state.hasIndex(0)).toBe(true);
            expect(state.hasIndex(1)).toBe(true);
            expect(state.hasIndex(2)).toBe(false);
            expect(state.hasIndex(-1)).toBe(false);
            expect(state.hasIndex(Number.NaN)).toBe(false);
            expect(state.hasIndex(Number.POSITIVE_INFINITY)).toBe(false);
            // The permissive programmatic model is unchanged: setSelectedIndex
            // still accepts a position hasIndex rejects, and the selection then
            // reads empty (GTK's INVALID_LIST_POSITION spelling).
            expect(state.setSelectedIndex(5)).toBe(true);
            expect(state.hasIndex(state.selectedIndex)).toBe(false);
            expect(state.selectedValue).toBe('');
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

        await it('coerces a non-finite programmatic index to 0', () => {
            const state = twoOptions();
            state.setSelectedIndex(1);
            expect(state.setSelectedIndex(Number.NaN)).toBe(true);
            expect(state.selectedIndex).toBe(0);
        });
    });

    await describe('SpinState numeric adjustment (Adw.SpinRow)', async () => {
        await it('clamps a programmatic value to [min, max]', () => {
            const state = new SpinState();
            state.setMin(0);
            state.setMax(10);
            state.setValue(99);
            expect(state.value).toBe(10);
            state.setValue(-5);
            expect(state.value).toBe(0);
        });

        await it('increments by step and clamps at max', () => {
            const state = new SpinState();
            state.setMin(0);
            state.setMax(4);
            state.setStep(2);
            expect(state.increment()).toBe(true);
            expect(state.value).toBe(2);
            expect(state.increment()).toBe(true);
            expect(state.value).toBe(4);
            expect(state.increment()).toBe(false); // clamped at max → no change
            expect(state.value).toBe(4);
        });

        await it('decrements by step', () => {
            const state = new SpinState();
            state.setMin(0);
            state.setMax(10);
            state.setValue(6);
            state.setStep(2);
            expect(state.decrement()).toBe(true);
            expect(state.value).toBe(4);
            expect(state.decrement()).toBe(true);
            expect(state.value).toBe(2);
        });

        await it('decrement clamps a partial step to min', () => {
            const state = new SpinState();
            state.setMin(0);
            state.setMax(10);
            state.setValue(1);
            state.setStep(5);
            expect(state.decrement()).toBe(true); // 1 - 5 = -4 → clamp 0
            expect(state.value).toBe(0);
        });

        await it('re-clamps the current value when min rises above it', () => {
            const state = new SpinState();
            state.setValue(3);
            expect(state.setMin(5)).toBe(true); // value 3 < new min 5 → re-clamped
            expect(state.value).toBe(5);
        });

        await it('re-clamps the current value when max drops below it', () => {
            const state = new SpinState();
            state.setValue(80);
            expect(state.setMax(50)).toBe(true);
            expect(state.value).toBe(50);
        });

        await it('rejects a non-positive or non-finite step (falls back to 1)', () => {
            const state = new SpinState();
            state.setStep(0);
            expect(state.step).toBe(1);
            state.setStep(-3);
            expect(state.step).toBe(1);
            state.setStep(Number.NaN);
            expect(state.step).toBe(1);
            state.setStep(4);
            expect(state.step).toBe(4);
        });

        await it('coerces a non-finite programmatic value to 0 (then clamps)', () => {
            const state = new SpinState();
            state.setMin(2);
            state.setMax(10);
            state.setValue(Number.NaN); // → 0 → clamp to min 2
            expect(state.value).toBe(2);
        });

        await it('tags interactive vs programmatic changes and notifies only on change', () => {
            const state = new SpinState();
            state.setMin(0);
            state.setMax(10);
            const changes: SpinStateChange[] = [];
            state.subscribe((c) => changes.push(c));

            state.setValue(5); // programmatic
            state.increment(); // interactive (5 -> 6)
            state.setValue(5); // programmatic (6 -> 5)
            state.setValue(5); // no change → no notify

            expect(changes).toStrictEqual([
                { value: 5, interactive: false },
                { value: 6, interactive: true },
                { value: 5, interactive: false },
            ]);
        });
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
