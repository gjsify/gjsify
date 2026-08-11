// `RadioGroupState`'s scenario matrix is not written out here: it is
// `RADIO_GROUP_VECTORS` (conformance/checks.ts), driven below AND by the browser
// suite against real `<adw-radio>` elements, so a divergence fails a test naming
// the input rather than two suites agreeing by luck.

import { describe, expect, it } from '@gjsify/unit';

import { RadioGroupState, resolveCheckState } from './checks.js';
import type { RadioGroupChange } from './checks.js';
import { RADIO_GROUP_VECTORS } from './conformance/checks.js';

export default async () => {
    await describe('resolveCheckState precedence (Adwaita check/radio glyphs)', async () => {
        await it('maps the two flags onto the three painted states', () => {
            expect(resolveCheckState(false, false)).toBe('unchecked');
            expect(resolveCheckState(true, false)).toBe('checked');
            expect(resolveCheckState(false, true)).toBe('indeterminate');
        });

        await it('indeterminate outranks checked', () => {
            // _checks.scss re-declares the glyph for `:indeterminate` after
            // both `:checked` rules at equal specificity, so the dash wins.
            expect(resolveCheckState(true, true)).toBe('indeterminate');
        });
    });

    await describe('RadioGroupState exclusivity (conformance vectors)', async () => {
        for (const vector of RADIO_GROUP_VECTORS) {
            await it(`${vector.name} — ${vector.rule}`, () => {
                const state = new RadioGroupState();
                const changes: RadioGroupChange[] = [];
                state.subscribe((change) => changes.push(change));

                for (const step of vector.steps) state.select(step.name, step.value);

                const selected = vector.selected.map(([group]) => [group, state.selected(group)]);
                expect(selected).toStrictEqual(vector.selected.map(([group, value]) => [group, value]));
                expect(changes).toStrictEqual(vector.emitted.map((change) => ({ ...change })));
            });
        }
    });

    await describe('RadioGroupState surface', async () => {
        await it('reports the change only when the selection actually moved', () => {
            const state = new RadioGroupState();
            expect(state.select('g', 'a')).toBe(true);
            expect(state.select('g', 'a')).toBe(false);
            expect(state.select('g', 'b')).toBe(true);
        });

        await it('unsubscribe stops further notifications', () => {
            const state = new RadioGroupState();
            const seen: RadioGroupChange[] = [];
            const unsubscribe = state.subscribe((change) => seen.push(change));

            state.select('g', 'a');
            unsubscribe();
            state.select('g', 'b');

            expect(seen).toStrictEqual([{ name: 'g', selected: 'a', deselected: null }]);
            // The state still moved — unsubscribing silences the listener, it
            // does not freeze the group.
            expect(state.selected('g')).toBe('b');
        });

        await it('a listener that unsubscribes mid-fan-out does not skip the next one', () => {
            const state = new RadioGroupState();
            const seen: string[] = [];
            const first = state.subscribe(() => {
                seen.push('first');
                first();
            });
            state.subscribe(() => seen.push('second'));

            state.select('g', 'a');

            expect(seen).toStrictEqual(['first', 'second']);
        });
    });
};
