// The portable adjustment against a REAL `Gtk.Adjustment` (ADR 0047 § Amendment).
//
// The two sibling renderers hold `ADJUSTMENT_AUTHORED_VECTORS` against `SpinState`, the
// core's port of the adjustment. This suite holds the same rows against the object
// `SpinState` is a port OF: every row is built into a `Gtk.Adjustment`, read back off
// it, and written through a real `Adw.SpinRow` — so the core's answer and GTK's cannot
// drift apart without a row here naming the input.

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
// Type position only — the descriptors pull Adw in for value use themselves.
import type Adw from 'gi://Adw?version=1';

import { expect, it, on } from '@gjsify/unit';

import { ADJUSTMENT_AUTHORED_VECTORS, ADJUSTMENT_PARSE_VECTORS } from '@gjsify/adwaita-core/conformance';

import { buildAdjustment, fromAdjustment, isPortableAdjustment } from './adjustment.js';
import { installDiagnosticsGate } from './conformance/index.js';
import { registerBuiltinWidgets } from './descriptors/index.js';
import { GtkHostError } from './errors.js';
import { createElement, materialize, setProp } from './host.js';
import { paramSpecs } from './props.js';
import { GTK_HOSTS, gated } from './testing/gate.mjs';

/** The refusal code a call raises, or what it did instead — so a wrong refusal reads as one. */
function codeOf(fn: () => unknown): string {
    try {
        fn();
    } catch (error) {
        return error instanceof GtkHostError ? error.code : `not-a-GtkHostError: ${String(error)}`;
    }
    return 'no throw';
}

/**
 * The four of the seven adjustment holders that have a widget in the shipped table and
 * take the property without a second one written first. `GtkScaleButton:adjustment` and
 * `GtkScrollbar:adjustment` exist too and go through the same ParamSpec branch; they are
 * not repeated here because a fifth and sixth identical row would prove nothing the
 * `GtkRange` and `GtkScrolledWindow` rows do not.
 */
const HOLDERS: ReadonlyArray<readonly [tag: string, prop: string, accessor: string]> = [
    ['adw-spin-row', 'adjustment', 'adjustment'],
    ['gtk-spin-button', 'adjustment', 'adjustment'],
    ['gtk-scale', 'adjustment', 'adjustment'],
    ['gtk-scrolled-window', 'hadjustment', 'hadjustment'],
];

export default async () => {
    await on(GTK_HOSTS, async () => {
        Gtk.init();
        registerBuiltinWidgets();

        // An adjustment GObject refuses is a CRITICAL at exit 0 and a stepper that cannot
        // move. Every block below asserts GTK reported nothing.
        const diagnostics = installDiagnosticsGate();

        await gated(diagnostics, 'buildAdjustment builds a real Gtk.Adjustment', async () => {
            await it('carries the six numbers', () => {
                const adjustment = buildAdjustment({
                    lower: 1,
                    upper: 9,
                    value: 4,
                    stepIncrement: 2,
                    pageIncrement: 3,
                    pageSize: 1,
                });
                expect(adjustment instanceof Gtk.Adjustment).toBe(true);
                expect(fromAdjustment(adjustment)).toStrictEqual({
                    value: 4,
                    lower: 1,
                    upper: 9,
                    stepIncrement: 2,
                    pageIncrement: 3,
                    pageSize: 1,
                });
            });

            await it('a plain object is an adjustment; a number, an array and a Gtk.Adjustment are not', () => {
                expect(isPortableAdjustment({})).toBe(true);
                expect(isPortableAdjustment({ upper: 10 })).toBe(true);
                expect(isPortableAdjustment(5)).toBe(false);
                expect(isPortableAdjustment([0, 10])).toBe(false);
                expect(isPortableAdjustment(null)).toBe(false);
                expect(isPortableAdjustment(new Gtk.Adjustment())).toBe(false);
            });
        });

        await gated(diagnostics, "the core's answer is what GTK keeps (shared conformance vectors)", async () => {
            for (const { input, adjustment, rule } of ADJUSTMENT_AUTHORED_VECTORS) {
                await it(rule, () => {
                    // Built and read back: the six numbers the core normalised are the six
                    // GTK holds, GTK's own clamp included.
                    expect(fromAdjustment(buildAdjustment(input))).toStrictEqual(adjustment);
                    // And through the widget, which is where a value would be re-clamped
                    // against a range that arrived late if the branch had one.
                    const el = createElement('adw-spin-row', { adjustment: input });
                    const row = materialize(el) as unknown as Adw.SpinRow;
                    expect(fromAdjustment(row.adjustment)).toStrictEqual(adjustment);
                    expect(row.value).toBe(adjustment.value);
                });
            }
        });

        await gated(diagnostics, 'the markup door is not this door (shared conformance vectors)', async () => {
            // `ADJUSTMENT_PARSE_VECTORS` are the JSON `adjustment` ATTRIBUTE, parsed by the
            // browser element because markup carries nothing else. A JSX attribute carries
            // the object itself, so a string here is the wrong shape and is refused by name
            // — the total parser would have read four of these six as "nothing authored"
            // and left the range at its default without a word. The `null` row is the
            // removal path and not a refusal, so it is not driven here.
            for (const { raw, rule } of ADJUSTMENT_PARSE_VECTORS) {
                if (raw === null) continue;
                await it(`${JSON.stringify(raw)} is refused, not parsed — ${rule}`, () => {
                    const el = createElement('adw-spin-row');
                    expect(codeOf(() => setProp(el, 'adjustment', raw))).toBe('bad-adjustment');
                });
            }
        });

        await gated(diagnostics, 'the widgets take it — four of the seven interfaces', async () => {
            for (const [tag, prop, accessor] of HOLDERS) {
                await it(`<${tag} ${prop}={{…}}> reaches a real Gtk.Adjustment`, () => {
                    const el = createElement(tag, { [prop]: { lower: 10, upper: 20, value: 15 } });
                    const widget = materialize(el) as unknown as Record<string, unknown>;
                    const adjustment = widget[accessor];
                    expect(adjustment instanceof Gtk.Adjustment).toBe(true);
                    const held = fromAdjustment(adjustment as Gtk.Adjustment);
                    expect([held.lower, held.upper, held.value]).toStrictEqual([10, 20, 15]);
                });
            }

            await it('a real Gtk.Adjustment still passes straight through', () => {
                const adjustment = new Gtk.Adjustment({ lower: 0, upper: 5, value: 2 });
                const el = createElement('adw-spin-row');
                setProp(el, 'adjustment', adjustment);
                materialize(el);
                expect((el.widget as unknown as Adw.SpinRow).adjustment).toBe(adjustment);
            });

            await it('`value` authored INSIDE the adjustment lands — the gallery tree’s spelling', () => {
                const el = createElement('adw-spin-row', {
                    title: 'Font size',
                    adjustment: { lower: 0, upper: 100, value: 16, stepIncrement: 1 },
                });
                expect((materialize(el) as unknown as Adw.SpinRow).value).toBe(16);
            });

            await it('`value` authored as the ROW property after the adjustment lands too', () => {
                // Author order is write order in `materialize`, so the range is installed
                // before the value is clamped against it. Pinned because the gallery relies
                // on the same order for `model` before `selected`.
                const el = createElement('adw-spin-row', { adjustment: { lower: 0, upper: 10 }, value: 7 });
                expect((materialize(el) as unknown as Adw.SpinRow).value).toBe(7);
            });

            await it('replacing the adjustment with an input naming no value lands on the LOWER bound', () => {
                // The object is the WHOLE adjustment (`adjustment.ts` header): this is what
                // `row.adjustment = new Gtk.Adjustment({ lower, upper })` does in a GJS
                // application, and the reason the React Native arm keys its memo on the
                // value as well as the range.
                const el = createElement('adw-spin-row', { adjustment: { lower: 0, upper: 100, value: 60 } });
                const row = materialize(el) as unknown as Adw.SpinRow;
                expect(row.value).toBe(60);
                setProp(el, 'adjustment', { lower: 10, upper: 50 });
                expect(row.adjustment.upper).toBe(50);
                expect(row.value).toBe(10);
            });
        });

        await gated(diagnostics, 'what the branch refuses, by name', async () => {
            await it('the ParamSpec is an adjustment on every holder — the premise', () => {
                for (const [tag, prop] of HOLDERS) {
                    const el = createElement(tag);
                    const spec = paramSpecs(el.descriptor.ctor(), el.descriptor.gtype).get(prop);
                    expect(spec === undefined).toBe(false);
                    expect(GObject.type_name((spec as GObject.ParamSpec).value_type)).toBe('GtkAdjustment');
                }
            });

            await it('a bare number is refused — it would be the value, which is its own property', () => {
                const el = createElement('adw-spin-row');
                expect(() => setProp(el, 'adjustment', 5)).toThrow('two spellings of one write');
                expect(codeOf(() => setProp(el, 'adjustment', 5))).toBe('bad-adjustment');
                // Nothing recorded: a refused value in `el.props` would throw again from
                // inside the next rebuild.
                expect('adjustment' in el.props).toBe(false);
            });

            await it('an array is refused the same way, and the kind is named', () => {
                const el = createElement('gtk-scale');
                expect(() => setProp(el, 'adjustment', [0, 10])).toThrow('got an array');
            });
        });
    });
};
