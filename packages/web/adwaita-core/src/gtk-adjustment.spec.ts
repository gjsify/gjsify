// `Gtk.Adjustment` as an authoring door — held against the value it has to produce.
//
// THE CLAIM UNDER TEST is that a range BUILT the GJS way and the same range WRITTEN as an
// object literal are one value, so an `adjustment` property cannot tell them apart. The
// equality cases assert against `normalizeAdjustment(<the literal a reader would have
// written>)` and against `SpinState`, which is the object both ports' `adjustment` setters
// actually drive.
//
// Compared as JSON rather than with `toEqual`: `@gjsify/unit`'s `toEqual` is `==`, so two
// different objects pass it whatever they hold.

import { describe, expect, it } from '@gjsify/unit';

import { ADW_ADJUSTMENT_DEFAULTS, normalizeAdjustment, SpinState } from './adjustment.js';
import type { AdwAdjustmentInput } from './adjustment.js';
import { GtkAdjustment } from './gtk-adjustment.js';

/** What an `adjustment` property reduces a value to, on either spelling. */
const range = (value: AdwAdjustmentInput) => JSON.stringify(normalizeAdjustment(value));

/** What the state machine behind every `adjustment` setter holds after taking one. */
const stateAfter = (value: AdwAdjustmentInput) => {
    const state = new SpinState();
    state.configure(value);
    return JSON.stringify({ adjustment: state.adjustment, value: state.value });
};

/** The gallery's own spin row, in the two spellings its two panes used to carry. */
const FONT_SIZE = { lower: 0, upper: 100, value: 16, stepIncrement: 1 };

export default async () => {
    await describe('Gtk.Adjustment IS the portable adjustment', async () => {
        await it('takes the GJS construct bag in camelCase, which is what the gallery writes', () => {
            const adjustment = new GtkAdjustment(FONT_SIZE);

            expect(adjustment.lower).toBe(0);
            expect(adjustment.upper).toBe(100);
            expect(adjustment.value).toBe(16);
            expect(adjustment.stepIncrement).toBe(1);
        });

        await it('defaults to the package range, not to GTK 0…0 step 0', () => {
            const adjustment = new GtkAdjustment();

            expect(adjustment.upper).toBe(ADW_ADJUSTMENT_DEFAULTS.upper);
            expect(adjustment.stepIncrement).toBe(ADW_ADJUSTMENT_DEFAULTS.stepIncrement);
        });

        await it('establishes the invariants on construction, as normalizeAdjustment does', () => {
            const adjustment = new GtkAdjustment({ lower: 10, upper: 2, value: 99, stepIncrement: 0 });

            expect(adjustment.upper).toBe(10);
            expect(adjustment.value).toBe(10);
            expect(adjustment.stepIncrement > 0).toBe(true);
        });
    });

    await describe('Gtk.Adjustment and a plain object are the SAME WRITE', async () => {
        await it('reduces to the same adjustment the gallery literal reduces to', () => {
            expect(range(new GtkAdjustment(FONT_SIZE))).toBe(range(FONT_SIZE));
        });

        await it('leaves SpinState in the same state, value included', () => {
            expect(stateAfter(new GtkAdjustment(FONT_SIZE))).toBe(stateAfter(FONT_SIZE));
        });

        await it('is the same write after a setter has moved a bound', () => {
            const adjustment = new GtkAdjustment(FONT_SIZE);
            adjustment.set_upper(24);
            adjustment.set_value(12);

            expect(stateAfter(adjustment)).toBe(stateAfter({ ...FONT_SIZE, upper: 24, value: 12 }));
        });

        await it('a range that EXCLUDES zero opens at its lower bound on both spellings', () => {
            expect(stateAfter(new GtkAdjustment({ lower: -100, upper: -50 }))).toBe(
                stateAfter({ lower: -100, upper: -50 }),
            );
        });
    });

    await describe('Gtk.Adjustment accessors', async () => {
        await it('answer the six numbers under the typelib spelling', () => {
            const adjustment = new GtkAdjustment({ ...FONT_SIZE, pageIncrement: 10, pageSize: 4 });

            expect(adjustment.get_value()).toBe(16);
            expect(adjustment.get_lower()).toBe(0);
            expect(adjustment.get_upper()).toBe(100);
            expect(adjustment.get_step_increment()).toBe(1);
            expect(adjustment.get_page_increment()).toBe(10);
            expect(adjustment.get_page_size()).toBe(4);
        });

        await it('clamp set_value to lie between lower and upper', () => {
            const adjustment = new GtkAdjustment(FONT_SIZE);
            adjustment.set_value(999);

            expect(adjustment.get_value()).toBe(100);
        });

        await it('keep the value inside the effective range when page_size takes it off the top', () => {
            const adjustment = new GtkAdjustment({ lower: 0, upper: 100, value: 100 });
            adjustment.set_page_size(10);

            expect(adjustment.get_value()).toBe(90);
        });

        await it('keep every other field when one setter runs', () => {
            const adjustment = new GtkAdjustment({ ...FONT_SIZE, pageSize: 5 });
            adjustment.set_lower(4);

            expect(adjustment.get_upper()).toBe(100);
            expect(adjustment.get_page_size()).toBe(5);
            expect(adjustment.get_value()).toBe(16);
        });
    });

    await describe('Gtk.Adjustment.configure and get_minimum_increment', async () => {
        await it('configure sets all six at once, in the GIR argument order', () => {
            const adjustment = new GtkAdjustment();
            adjustment.configure(16, 0, 100, 1, 10, 0);

            expect(range(adjustment)).toBe(range({ ...FONT_SIZE, pageIncrement: 10, pageSize: 0 }));
        });

        await it('get_minimum_increment is the smaller of step and page increment', () => {
            expect(new GtkAdjustment({ stepIncrement: 1, pageIncrement: 10 }).get_minimum_increment()).toBe(1);
            expect(new GtkAdjustment({ stepIncrement: 25, pageIncrement: 5 }).get_minimum_increment()).toBe(5);
        });
    });
};
