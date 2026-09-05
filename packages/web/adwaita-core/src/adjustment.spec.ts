// The portable adjustment (ADR 0047): the value, its two doors, and the object that
// watches it.
//
// The clamp/step-edge matrix moved here with `SpinState` and is unchanged in what it
// asserts — the same numbers for the same authored range, now written in the GIR field
// names. What is new below is the range/value signal split, `pageSize`'s effect on where a
// value may go, and the two total doors (`normalizeAdjustment`, `parseAdjustment`).

import { describe, it, expect } from '@gjsify/unit';

import {
    ADW_ADJUSTMENT_DEFAULTS,
    SpinState,
    adjustmentRange,
    clampAdjustmentValue,
    normalizeAdjustment,
    parseAdjustment,
    snapAdjustmentValue,
} from './adjustment.js';
import type { AdwAdjustment, SpinStateChange } from './adjustment.js';
import {
    ADJUSTMENT_AUTHORED_VECTORS,
    ADJUSTMENT_PARSE_VECTORS,
    ADJUSTMENT_SNAP_VECTORS,
} from './conformance/adjustment.js';

/** A spin-row-shaped adjustment: a scalar value, so `pageSize` is 0. */
const scalar = (lower: number, upper: number, stepIncrement = 1): AdwAdjustment =>
    normalizeAdjustment({ lower, upper, stepIncrement });

export default async () => {
    await describe('@gjsify/adwaita-core — the portable adjustment', async () => {
        // THE SHARED TABLES FIRST. Both renderer suites drive these same rows, so a
        // divergence between the three surfaces fails a test naming the authored input
        // rather than three suites agreeing by luck. What follows them is this module's
        // own edges — the signal split and the snapshot — which no renderer can observe.
        await describe('ADJUSTMENT_AUTHORED_VECTORS — what an author writes, and where it lands', async () => {
            for (const vector of ADJUSTMENT_AUTHORED_VECTORS) {
                await it(vector.rule, () => {
                    expect(normalizeAdjustment(vector.input)).toStrictEqual({ ...vector.adjustment });
                });
            }
        });

        await describe('ADJUSTMENT_PARSE_VECTORS — the JSON attribute door', async () => {
            for (const vector of ADJUSTMENT_PARSE_VECTORS) {
                await it(vector.rule, () => {
                    expect(parseAdjustment(vector.raw)).toStrictEqual({ ...vector.input });
                });
            }
        });

        await describe('ADJUSTMENT_SNAP_VECTORS — where a dragged value lands', async () => {
            for (const vector of ADJUSTMENT_SNAP_VECTORS) {
                await it(vector.rule, () => {
                    expect(snapAdjustmentValue(normalizeAdjustment(vector.input), vector.from)).toBe(vector.snapped);
                });
            }
        });

        await describe('normalizeAdjustment fills an authored subset out to six numbers', async () => {
            await it('takes the unwritten fields from the defaults', () => {
                expect(normalizeAdjustment({ upper: 10 })).toStrictEqual({
                    value: 0,
                    lower: 0,
                    upper: 10,
                    stepIncrement: 1,
                    pageIncrement: 1,
                    pageSize: 0,
                });
            });

            await it('takes them from a base when one is given (the configure case)', () => {
                const base = normalizeAdjustment({ lower: 1, upper: 20, stepIncrement: 5, value: 6 });
                expect(normalizeAdjustment({ upper: 30 }, base)).toStrictEqual({
                    value: 6,
                    lower: 1,
                    upper: 30,
                    stepIncrement: 5,
                    pageIncrement: 5,
                    pageSize: 0,
                });
            });

            await it('refuses an upper below the lower rather than inverting the range', () => {
                const adjustment = normalizeAdjustment({ lower: 10, upper: 2 });
                expect(adjustment.upper).toBe(10);
                expect(adjustmentRange(adjustment)).toStrictEqual([10, 10]);
            });

            await it('refuses a zero, negative or non-finite step (a stepper that cannot move)', () => {
                expect(normalizeAdjustment({ stepIncrement: 0 }).stepIncrement).toBe(1);
                expect(normalizeAdjustment({ stepIncrement: -3 }).stepIncrement).toBe(1);
                expect(normalizeAdjustment({ stepIncrement: Number.NaN }).stepIncrement).toBe(1);
                expect(normalizeAdjustment({ stepIncrement: 4 }).stepIncrement).toBe(4);
            });

            await it('a REFUSED step keeps what the base held, rather than falling to 1', () => {
                // Declining a write must not change the state: a state stepping by 5 that is
                // handed a 0 keeps stepping by 5.
                const base = normalizeAdjustment({ stepIncrement: 5 });
                expect(normalizeAdjustment({ stepIncrement: 0 }, base).stepIncrement).toBe(5);
                expect(normalizeAdjustment({ stepIncrement: -1 }, base).stepIncrement).toBe(5);

                // And a BASE that carries an impossible step does not propagate it: this
                // function establishes the invariant, so no argument can talk it out of one.
                const broken = { value: 0, lower: 0, upper: 10, stepIncrement: 0, pageIncrement: 0, pageSize: 0 };
                expect(normalizeAdjustment({}, broken).stepIncrement).toBe(1);
                expect(normalizeAdjustment({ stepIncrement: -2 }, broken).stepIncrement).toBe(1);
            });

            await it('lets a page increment EQUAL to the step follow it', () => {
                expect(normalizeAdjustment({ stepIncrement: 5 }).pageIncrement).toBe(5);
                expect(normalizeAdjustment({ stepIncrement: 5, pageIncrement: 20 }).pageIncrement).toBe(20);

                // The test is the two NUMBERS, not the author's intent — one written to the
                // same value as the step is indistinguishable from one that defaulted to it,
                // and moves with it.
                const paired = normalizeAdjustment({ stepIncrement: 2, pageIncrement: 2 });
                expect(normalizeAdjustment({ stepIncrement: 7 }, paired).pageIncrement).toBe(7);
                const apart = normalizeAdjustment({ stepIncrement: 2, pageIncrement: 9 });
                expect(normalizeAdjustment({ stepIncrement: 7 }, apart).pageIncrement).toBe(9);
            });

            await it('clamps the authored value last, against the range the other five describe', () => {
                expect(normalizeAdjustment({ lower: 5, upper: 10, value: 1 }).value).toBe(5);
                expect(normalizeAdjustment({ lower: 5, upper: 10, value: 99 }).value).toBe(10);
            });

            await it('refuses a negative page size', () => {
                expect(normalizeAdjustment({ pageSize: -4 }).pageSize).toBe(0);
            });
        });

        await describe('pageSize takes its bite out of the top, as set_value documents', async () => {
            await it('reduces the reachable upper end to upper - pageSize', () => {
                const scrollbar = normalizeAdjustment({ lower: 0, upper: 100, pageSize: 20 });
                expect(adjustmentRange(scrollbar)).toStrictEqual([0, 80]);
                expect(clampAdjustmentValue(scrollbar, 95)).toBe(80);
            });

            await it('floors at the lower bound when the page is larger than the range', () => {
                const all = normalizeAdjustment({ lower: 0, upper: 10, pageSize: 40 });
                expect(adjustmentRange(all)).toStrictEqual([0, 0]);
            });

            await it('leaves a scalar adjustment reaching its upper, which is the spin row case', () => {
                expect(adjustmentRange(scalar(0, 10))).toStrictEqual([0, 10]);
            });
        });

        await describe('a non-finite value lands on the LOWER bound, not on zero', async () => {
            // The `SpinState` this replaces coerced a non-finite value to 0 and clamped
            // afterwards, which is only harmless while 0 is inside the range. On a range
            // that does not contain it the coercion pushed the value to the far END:
            // `[-5, -1]` clamped 0 to -1, so a `NaN` write MAXIMISED the value.
            await it('does not maximise a value on a range that excludes zero', () => {
                expect(clampAdjustmentValue(scalar(-5, -1), Number.NaN)).toBe(-5);
            });

            // ±Infinity is the other half of that split: it carries a direction, so it
            // clamps to the bound it is heading for rather than to the lower one.
            await it('clamps an infinity to the bound it is heading for', () => {
                const negative = scalar(-5, -1);
                expect(clampAdjustmentValue(negative, Number.POSITIVE_INFINITY)).toBe(-1);
                expect(clampAdjustmentValue(negative, Number.NEGATIVE_INFINITY)).toBe(-5);
            });

            await it('still lands inside a range that contains zero', () => {
                const state = new SpinState();
                state.configure({ lower: 2, upper: 10 });
                state.setValue(Number.NaN);
                expect(state.value).toBe(2);
            });
        });

        await describe('parseAdjustment reads the authored fields and nothing else', async () => {
            await it('yields only what the JSON wrote', () => {
                expect(parseAdjustment('{"lower":1,"upper":20,"stepIncrement":5}')).toStrictEqual({
                    lower: 1,
                    upper: 20,
                    stepIncrement: 5,
                });
            });

            await it('drops a key an adjustment does not have, and a non-numeric one', () => {
                expect(parseAdjustment('{"min":1,"upper":"20","pageSize":4}')).toStrictEqual({ pageSize: 4 });
            });

            await it('yields nothing authored for absent, unparseable and non-object input', () => {
                for (const raw of [null, undefined, '', 'not json', '[1,2]', '7', 'null']) {
                    expect(parseAdjustment(raw)).toStrictEqual({});
                }
            });

            await it('leaves the value where it is, whichever attribute arrived first', () => {
                const state = new SpinState();
                state.setValue(7);
                state.configure(parseAdjustment('{"upper":20}'));
                expect(state.value).toBe(7);
                expect(state.adjustment.upper).toBe(20);
            });

            await it('is a whole adjustment once normalised, for a caller that wants one', () => {
                expect(normalizeAdjustment(parseAdjustment('{"upper":20}'))).toStrictEqual({
                    ...ADW_ADJUSTMENT_DEFAULTS,
                    upper: 20,
                });
            });
        });

        await describe('snapAdjustmentValue counts ticks from the LOWER bound', async () => {
            await it('moves to the nearest tick on the grid the lower bound starts', () => {
                const offset = normalizeAdjustment({ lower: 1, upper: 10, stepIncrement: 3 });
                // Ticks are 1, 4, 7, 10 — not 3, 6, 9.
                expect(snapAdjustmentValue(offset, 5)).toBe(4);
                expect(snapAdjustmentValue(offset, 6)).toBe(7);
                expect(snapAdjustmentValue(offset, 1.4)).toBe(1);
            });

            await it('never leaves the range, and an upper off the grid is not a tick', () => {
                const uneven = normalizeAdjustment({ lower: 0, upper: 10, stepIncrement: 3 });
                // Ticks are 0, 3, 6, 9 — 12 is outside, so the top of the range is NOT
                // reachable by snapping. That is what `snap-to-ticks` does, and it is what
                // the slider row did before the arithmetic moved here.
                expect(snapAdjustmentValue(uneven, 11)).toBe(9);
                expect(snapAdjustmentValue(uneven, 99)).toBe(9);
                expect(snapAdjustmentValue(uneven, -99)).toBe(0);
            });

            await it('reaches an on-grid bound whose step is a DECIMAL', () => {
                // `(0.3 - 0) / 0.1` is 2.9999999999999996 in binary floating point, so a
                // plain `Math.floor` of it drops a whole tick — and `0 + 3 * 0.1` is
                // 0.30000000000000004, which is outside the range it belongs to. Both ends
                // of that error are corrected, and a fractional range is what an author
                // writes rather than an exotic case.
                expect(snapAdjustmentValue(scalar(0, 0.3, 0.1), 0.3)).toBe(0.3);
                expect(snapAdjustmentValue(scalar(0, 0.6, 0.2), 0.6)).toBe(0.6);
                expect(snapAdjustmentValue(scalar(0, 2.4, 0.8), 2.4)).toBe(2.4);
            });

            await it('answers a TICK even when the drag ends exactly on an off-grid bound', () => {
                // The gap above the last tick decides it, and it has to be more than half a
                // step for the rounding to reach the bound at all: `[0, 10]` step 4 has
                // ticks 0, 4, 8 and a gap of 2. Clamping the VALUE answered 10 here.
                expect(snapAdjustmentValue(scalar(0, 10, 4), 10)).toBe(8);
                expect(snapAdjustmentValue(scalar(0, 5, 2), 5)).toBe(4);
            });

            await it('does reach an upper that IS on the grid', () => {
                expect(snapAdjustmentValue(scalar(0, 9, 3), 99)).toBe(9);
            });

            await it('is the identity on a value already on a tick', () => {
                expect(snapAdjustmentValue(scalar(0, 10, 2), 6)).toBe(6);
            });
        });

        await describe('SpinState: the clamp and step edges', async () => {
            await it('clamps a programmatic value into the range', () => {
                const state = new SpinState();
                state.configure({ lower: 0, upper: 10 });
                state.setValue(99);
                expect(state.value).toBe(10);
                state.setValue(-5);
                expect(state.value).toBe(0);
            });

            await it('increments by the step and clamps at the upper end', () => {
                const state = new SpinState();
                state.configure({ lower: 0, upper: 4, stepIncrement: 2 });
                expect(state.increment()).toBe(true);
                expect(state.value).toBe(2);
                expect(state.increment()).toBe(true);
                expect(state.value).toBe(4);
                expect(state.increment()).toBe(false); // clamped → no change
                expect(state.value).toBe(4);
            });

            await it('decrements by the step, and a partial step clamps to the lower end', () => {
                const state = new SpinState();
                state.configure({ lower: 0, upper: 10, stepIncrement: 5, value: 1 });
                expect(state.decrement()).toBe(true); // 1 - 5 = -4 → clamp 0
                expect(state.value).toBe(0);
            });

            await it('re-clamps the value when a bound moves under it', () => {
                const rising = new SpinState();
                rising.setValue(3);
                expect(rising.configure({ lower: 5 })).toBe(true);
                expect(rising.value).toBe(5);

                const falling = new SpinState();
                falling.setValue(80);
                expect(falling.configure({ upper: 50 })).toBe(true);
                expect(falling.value).toBe(50);
            });

            await it('follows a moved bound until a value is WRITTEN, and re-clamps after', () => {
                // A fresh adjustment has no value yet, so the bottom of the range is where
                // it sits: clamping the default 0 into a range that excludes zero would put
                // it on the MAXIMUM instead.
                const fresh = new SpinState();
                fresh.configure({ lower: -100, upper: -50 });
                expect(fresh.value).toBe(-100);

                // Once a value has been written, a moved bound RE-CLAMPS it — the nearer
                // end, not the bottom.
                const used = new SpinState();
                used.setValue(80);
                used.configure({ upper: 50 });
                expect(used.value).toBe(50);

                // And a written value resting ON the lower bound stays where it is when the
                // bound moves away from it, which is what tells the two rules apart.
                const resting = new SpinState();
                resting.configure({ lower: 5, upper: 10 });
                resting.setValue(5);
                resting.configure({ lower: 0 });
                expect(resting.value).toBe(5);
            });

            await it('does NOT count a write that says nothing as a placement', () => {
                // A non-finite value expresses no position, and a stepper press at the end
                // of the range moves nothing — neither may decide where a later range move
                // puts the value.
                const nan = new SpinState();
                nan.configure({ value: Number.NaN });
                nan.configure({ lower: -100, upper: -50 });
                expect(nan.value).toBe(-100);

                const floored = new SpinState();
                expect(floored.decrement()).toBe(false);
                floored.configure({ lower: -100, upper: -50 });
                expect(floored.value).toBe(-100);

                // But a write that names a finite value HAS placed it, even where the number
                // did not move: 0 was written, and a range excluding it re-clamps.
                const written = new SpinState();
                written.setValue(0);
                written.configure({ lower: -100, upper: -50 });
                expect(written.value).toBe(-50);
            });

            await it('counts a value inside a configure as written', () => {
                const state = new SpinState();
                state.configure({ lower: 0, upper: 100, value: 40 });
                state.configure({ lower: 60 });
                expect(state.value).toBe(60); // re-clamped, not re-seeded — same number, and
                state.configure({ lower: 0 });
                expect(state.value).toBe(60); // THIS is the row: a seeded value would follow.
            });

            await it('reports no change when configure is handed what it already holds', () => {
                const state = new SpinState();
                state.configure({ lower: 0, upper: 10, value: 4 });
                expect(state.configure({ lower: 0, upper: 10, value: 4 })).toBe(false);
                expect(state.configure({})).toBe(false);
            });

            await it('hands out a snapshot, so a caller cannot write through it', () => {
                const state = new SpinState();
                const snapshot = state.adjustment;
                snapshot.upper = 3;
                expect(state.adjustment.upper).toBe(ADW_ADJUSTMENT_DEFAULTS.upper);
            });
        });

        await describe('SpinState: value-changed and changed are separate signals', async () => {
            await it('tags interactive vs programmatic value changes and notifies only on change', () => {
                const state = new SpinState();
                state.configure({ lower: 0, upper: 10 });
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

            await it('emits `changed` for a range move and NOT for a value move', () => {
                const state = new SpinState();
                const ranges: AdwAdjustment[] = [];
                state.subscribeChanged((a) => ranges.push(a));

                state.setValue(4);
                expect(ranges).toStrictEqual([]);

                state.configure({ upper: 50 });
                expect(ranges.length).toBe(1);
                expect(ranges[0]?.upper).toBe(50);
            });

            await it('emits `changed` before `value-changed` when a bound re-clamps the value', () => {
                const state = new SpinState();
                state.setValue(80);
                const order: string[] = [];
                state.subscribeChanged((a) => order.push(`changed:${a.upper}`));
                state.subscribe((c) => order.push(`value:${c.value}:${c.interactive}`));

                state.configure({ upper: 50 });

                // The range a listener re-reads must already be the current one.
                expect(order).toStrictEqual(['changed:50', 'value:50:false']);
            });

            await it('unsubscribes from either signal independently', () => {
                const state = new SpinState();
                const seen: string[] = [];
                const offValue = state.subscribe(() => seen.push('value'));
                state.subscribeChanged(() => seen.push('changed'));

                offValue();
                state.setValue(3);
                state.configure({ upper: 5 });

                expect(seen).toStrictEqual(['changed']);
            });
        });
    });
};
