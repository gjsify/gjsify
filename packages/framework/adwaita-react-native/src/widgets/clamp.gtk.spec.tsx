/** @jsxImportSource @gjsify/gtk-host/react */
// The GTK half, against the libadwaita that is installed — tree first, picture second.
//
// A TREE ASSERT AND A PHOTOGRAPH ANSWER DIFFERENT QUESTIONS. `get_child()` returning
// the label proves `set_child` was called; it says nothing about whether the label was
// ever allocated. GTK's failure mode is exit 0 with an empty window, so the second
// question needs `shotEvidence` — the strict descendant count, the allocation, and the
// PNG byte count of a real GSK render. That distinction is not hypothetical here: four
// `className`-bearing documentation snippets in this repository were measured to
// produce an empty window at exit 0 with zero GTK diagnostics, because the styling
// layer refused the tree before the first render.
//
// The window, the pump, the tree search and the inlined capture are the shared harness
// in `../testing/gtk.spec.tsx`, which also carries why the picture is taken without
// `@gjsify/devtools`.
//
// THE NUMBERS ARE SHARED WITH `clamp.native.spec.tsx`. A 1000-point frame with
// `maximum-size` 400 puts the child at x=300, width=400 on both renderers, because
// `adw_clamp_layout_allocate` and `@gjsify/adwaita-core`'s port of it are the same
// curve. Asserting the number rather than "it looks clamped" is what makes the two
// halves one widget.
//
// AND THE SHARED NUMBER IS TAKEN TWICE, ON PURPOSE. `maximum-size` 400 with the default
// `tightening-threshold` of 400 collapses the curve: `lower`, `max` and `upper` all land
// on 400, the eased region has zero width, and the two renderers agree there for a
// reason that says nothing about the easing. So the second case is a 700-point frame at
// the DEFAULT 600/400, which sits inside `lower`=400 … `upper`=1000 — libadwaita reads
// 575 at x=62 there, a `min()` approximation would read 600, and the React Native suite
// asserts that same pair as a style object.

import type Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';
import { expect, it } from '@gjsify/unit';
import { shotEvidence, blankReason } from '@gjsify/gtk-host';

import { FRAME_WIDTH, capture, find, laidOut, typeOf, withGtk } from '../testing/gtk.spec.js';
import { AdwBin } from './bin.gtk.js';
import { AdwClamp } from './clamp.gtk.js';

/** Inside `lower` … `upper` for the DEFAULT 600/400 — the eased region. */
const EASED_FRAME_WIDTH = 700;

export default async () => {
    await withGtk(async ({ gated, display }) => {
        await gated('the widgets are the real libadwaita ones', async () => {
            await it('renders AdwBin as an Adw.Bin holding its child', async () => {
                laidOut(
                    <AdwBin>
                        <gtk-label label="inside" />
                    </AdwBin>,
                    (container) => {
                        const bin = find(container, 'AdwBin') as Adw.Bin;
                        expect(typeOf(bin.get_child() as Gtk.Widget)).toBe('GtkLabel');
                    },
                );
            });

            await it('renders AdwClamp as an Adw.Clamp carrying the property', async () => {
                laidOut(
                    <AdwClamp maximumSize={400}>
                        <gtk-label label="inside" />
                    </AdwClamp>,
                    (container) => {
                        const clamp = find(container, 'AdwClamp') as Adw.Clamp;
                        expect(clamp.maximumSize).toBe(400);
                        expect(typeOf(clamp.get_child() as Gtk.Widget)).toBe('GtkLabel');
                    },
                );
            });

            // A DIVERGENCE, pinned rather than asserted as correct. `Adw.Bin` is a
            // one-child widget and gtk-host's `single` policy fills that slot by
            // `set_child`, so a SECOND child evicts the first: measured, the tree keeps
            // "two" and loses "one", with no throw, no host error and — asserted by this
            // describe's own diagnostics gate — not one GLib message either. The React
            // Native half renders both (`bin.native.spec.tsx` asserts that), so this is
            // the one place a caller can write the same JSX and get two different
            // pictures. The README names it; this row is what stops either side moving
            // without the other being reconsidered.
            await it('keeps only the LAST child, where React Native keeps both', async () => {
                laidOut(
                    <AdwBin>
                        <gtk-label label="one" />
                        <gtk-label label="two" />
                    </AdwBin>,
                    (container) => {
                        const bin = find(container, 'AdwBin') as Adw.Bin;
                        const child = bin.get_child() as Gtk.Label;
                        expect(typeOf(child)).toBe('GtkLabel');
                        expect(child.label).toBe('two');
                    },
                );
            });
        });

        // The other half of the pair `clamp.native.spec.tsx` calls "the property range
        // both halves answer alike". Until this describe existed, that half asserted a
        // NUMBER for React Native and a GTK behaviour in a COMMENT — and the comment was
        // wrong in both rows measured here: a raw `maximum-size={NaN}` reached the widget
        // as 0 rather than leaving the default, and a raw `maximum-size={-5}` kept 600
        // where the React Native half answered 0. `installDiagnosticsGate` makes the
        // third claim — that neither value costs a `GLib-GObject-CRITICAL` — an
        // assertion rather than a hope; before `clamp.gtk.tsx` normalised, the negative
        // row raised one.
        //
        // The PROPERTY is read here rather than the allocation, and that matters only
        // for the negative row: `maximum-size` 0 allocates the child its own intrinsic
        // minimum on GTK and 0 on React Native, which is the `childMin` divergence the
        // README names and not this rule.
        await gated('the property range both halves answer alike', async () => {
            const authored = (value: number, body: (clamp: Adw.Clamp) => void): void =>
                laidOut(
                    <AdwClamp maximumSize={value}>
                        <gtk-label label="inside" />
                    </AdwClamp>,
                    (container) => body(find(container, 'AdwClamp') as Adw.Clamp),
                );

            await it('truncates a fractional maximum, as an int property does', async () => {
                authored(400.7, (clamp) => expect(clamp.maximumSize).toBe(400));
            });

            await it('falls back to libadwaita’s default for a value GObject cannot store', async () => {
                authored(Number.NaN, (clamp) => expect(clamp.maximumSize).toBe(600));
            });

            await it('takes a negative to the range floor instead of GObject’s refusal', async () => {
                authored(-5, (clamp) => expect(clamp.maximumSize).toBe(0));
            });
        });

        if (display !== null) {
            await gated('the picture, not only the setter', async () => {
                await it('clamps and centres the child at the shared numbers', async () => {
                    laidOut(
                        <AdwClamp maximumSize={400}>
                            <gtk-label label="inside" hexpand={true} />
                        </AdwClamp>,
                        (container) => {
                            const clamp = find(container, 'AdwClamp');
                            const evidence = shotEvidence(clamp, capture);
                            expect(blankReason(evidence)).toBe(null);
                            expect(clamp.get_width()).toBe(FRAME_WIDTH);

                            const child = find(clamp, 'GtkLabel');
                            const bounds = child.compute_bounds(clamp);
                            expect(bounds[0]).toBe(true);
                            // The same pair `clamp.native.spec.tsx` asserts as a style.
                            expect(Math.round(bounds[1].get_width())).toBe(400);
                            expect(Math.round(bounds[1].get_x())).toBe(300);
                        },
                    );
                });

                await it('rides the easing curve, where a min() would not', async () => {
                    laidOut(
                        <AdwClamp>
                            <gtk-label label="inside" hexpand={true} />
                        </AdwClamp>,
                        (container) => {
                            const clamp = find(container, 'AdwClamp');
                            const evidence = shotEvidence(clamp, capture);
                            expect(blankReason(evidence)).toBe(null);
                            expect(clamp.get_width()).toBe(EASED_FRAME_WIDTH);

                            const child = find(clamp, 'GtkLabel');
                            const bounds = child.compute_bounds(clamp);
                            expect(bounds[0]).toBe(true);
                            // 575, not the 600 a `min(available, maximum)` would give —
                            // and the pair `clamp.native.spec.tsx` asserts as a style.
                            expect(Math.round(bounds[1].get_width())).toBe(575);
                            expect(Math.round(bounds[1].get_x())).toBe(62);
                        },
                        { frameWidth: EASED_FRAME_WIDTH },
                    );
                });
            });
        }
    });
};
