/** @jsxImportSource @gjsify/gtk-host/react */
// The GTK half of `AdwWrapBox`, against the libadwaita that is installed.
//
// THE ALLOCATION IS THE ASSERTION. `Adw.WrapBox` is `adw-wrap-layout.c` itself, so what
// is worth reading off it is where the children ended up: three 100-point children in a
// 1000-point frame at `child-spacing` 20 sit at x=0, x=120 and x=240, and moving `align`
// to 1 pushes a two-child line to x=780 and x=900. Both are measured off the live tree,
// and both are the number a `flex-start`-only renderer would get wrong.
//
// THE NORMALISERS ARE VISIBLE HERE, and the diagnostics gate is what makes them visible.
// `align` is `g_param_spec_float (…, 0, 1, 0, …)`, so `align={2}` written straight
// through `set_property` is refused by `g_param_value_validate` — the property KEEPS its
// default 0 and GObject emits a `GLib-GObject-CRITICAL`. Through
// `normalizeWrapBoxAlign` it is 1, and the gate asserts the critical never happened. The
// negative-spacing row lands on the same value either way and differs only in that
// diagnostic, which is exactly why the gate is not decoration.
//
// THE CHILD POLICY IS NEW IN gtk-host. `adw-wrap-box` had a generated tag and no curated
// placement rule, so every child was an `uncurated-placement` refusal; the fix is a
// descriptor in `descriptors/adw.ts` and this suite is what exercises it.
//
// The harness (window, pump, tree search, diagnostics gate) is `../testing/gtk.spec.tsx`.

import Adw from 'gi://Adw?version=1';
import type Gtk from 'gi://Gtk?version=4.0';
import { expect, it } from '@gjsify/unit';
import { gtkChildren } from '@gjsify/gtk-host/conformance';

import { FRAME_WIDTH, find, laidOut, typeOf, withGtk } from '../testing/gtk.spec.js';
import { AdwWrapBox } from './wrap-box.gtk.js';

/** `Adw.WrapBox`, through the properties this suite reads back. */
type WrapBox = Gtk.Widget & {
    childSpacing: number;
    lineSpacing: number;
    align: number;
    justify: number;
    justifyLastLine: boolean;
    lineHomogeneous: boolean;
    naturalLineLength: number;
    packDirection: number;
    wrapPolicy: number;
    childSpacingUnit: number;
};

/** The direct children's x positions within the box, rounded. */
const columns = (box: Gtk.Widget): number[] =>
    [...gtkChildren(box)].map((child) => {
        const bounds = child.compute_bounds(box);
        if (!bounds[0]) throw new Error(`no bounds for ${typeOf(child)}`);
        return Math.round(bounds[1].get_x());
    });

/** Three equally wide children, so the arithmetic is the spacing and nothing else. */
const cells = ['one', 'two', 'three'].map((label) => <gtk-label key={label} label={label} width-request={100} />);

export default async () => {
    await withGtk(async ({ gated }) => {
        await gated('the children are laid out where libadwaita puts them', async () => {
            await it('spaces a line by child-spacing, from the start', async () => {
                laidOut(<AdwWrapBox childSpacing={20}>{cells}</AdwWrapBox>, (container) => {
                    const box = find(container, 'AdwWrapBox');
                    expect(box.get_width()).toBe(FRAME_WIDTH);
                    expect(columns(box)).toStrictEqual([0, 120, 240]);
                });
            });

            await it('moves the whole line block by align, which is a MAIN-axis offset', async () => {
                // 1000 − (2 × 100 + 20) = 780, so `align={1}` puts the pair against the
                // end of the line. A renderer that read `align` as a cross-axis
                // alignment — the easy mistake — would leave both at 0 and 120.
                laidOut(
                    <AdwWrapBox childSpacing={20} align={1}>
                        {cells.slice(0, 2)}
                    </AdwWrapBox>,
                    (container) => {
                        expect(columns(find(container, 'AdwWrapBox'))).toStrictEqual([780, 900]);
                    },
                );
            });

            await it('reorders by MOVING the widgets, not by rebuilding the list', async () => {
                // The other half of the new descriptor. `append` is exercised by every
                // test above; `insert_child_after` and `reorder: 'native'` are only
                // reached by an UPDATE, and nothing else in this package performs one —
                // so without this the two methods were declared, checked to EXIST by
                // gtk-host's descriptor sweep, and never called.
                //
                // IDENTITY IS THE ASSERTION, not the order. A host that tore the list
                // down and rebuilt it puts the labels in exactly the right places with
                // three different widgets, and a position-only assertion cannot tell the
                // two apart — which is the reorder bug the shadow tree exists to prevent.
                laidOut(<AdwWrapBox childSpacing={20}>{cells}</AdwWrapBox>, (container, _window, rerender) => {
                    const box = find(container, 'AdwWrapBox');
                    const before = [...gtkChildren(box)];
                    expect(before.map((child) => (child as Gtk.Label).label)).toStrictEqual(['one', 'two', 'three']);
                    rerender(<AdwWrapBox childSpacing={20}>{[cells[2], cells[0], cells[1]]}</AdwWrapBox>);
                    const after = [...gtkChildren(box)];
                    expect(after.map((child) => (child as Gtk.Label).label)).toStrictEqual(['three', 'one', 'two']);
                    expect(after.map((child) => before.indexOf(child))).toStrictEqual([2, 0, 1]);
                    expect(columns(box)).toStrictEqual([0, 120, 240]);
                });
            });
        });

        await gated('the fourteen properties reach the widget', async () => {
            await it('carries every authored property onto Adw.WrapBox', async () => {
                laidOut(
                    <AdwWrapBox
                        childSpacing={12}
                        childSpacingUnit="pt"
                        lineSpacing={6}
                        align={0.5}
                        justify="fill"
                        justifyLastLine={true}
                        lineHomogeneous={true}
                        naturalLineLength={300}
                        packDirection="end-to-start"
                        wrapReverse={true}
                        wrapPolicy="minimum"
                        orientation="vertical"
                    >
                        {cells}
                    </AdwWrapBox>,
                    (container) => {
                        const box = find(container, 'AdwWrapBox') as WrapBox;
                        expect(box.childSpacing).toBe(12);
                        expect(box.childSpacingUnit).toBe(Adw.LengthUnit.PT);
                        expect(box.lineSpacing).toBe(6);
                        expect(box.align).toBe(0.5);
                        expect(box.justify).toBe(Adw.JustifyMode.FILL);
                        expect(box.justifyLastLine).toBe(true);
                        expect(box.lineHomogeneous).toBe(true);
                        expect(box.naturalLineLength).toBe(300);
                        expect(box.packDirection).toBe(Adw.PackDirection.END_TO_START);
                        expect(box.wrapPolicy).toBe(Adw.WrapPolicy.MINIMUM);
                    },
                );
            });

            await it('leaves an omitted property on libadwaita’s own default', async () => {
                laidOut(<AdwWrapBox>{cells}</AdwWrapBox>, (container) => {
                    const box = find(container, 'AdwWrapBox') as WrapBox;
                    expect(box.childSpacing).toBe(0);
                    expect(box.align).toBe(0);
                    expect(box.justify).toBe(Adw.JustifyMode.NONE);
                    expect(box.wrapPolicy).toBe(Adw.WrapPolicy.NATURAL);
                    expect(box.naturalLineLength).toBe(-1);
                });
            });
        });

        await gated('the property range both halves answer alike', async () => {
            await it('clamps an out-of-range align INTO the range, where GObject would refuse it', async () => {
                // The row that separates a normalised value from an unnormalised one:
                // through `set_property` a raw 2 leaves `align` at 0 and costs a
                // `GLib-GObject-CRITICAL` this describe's gate fails on.
                laidOut(<AdwWrapBox align={2}>{cells}</AdwWrapBox>, (container) => {
                    expect((find(container, 'AdwWrapBox') as WrapBox).align).toBe(1);
                });
            });

            await it('takes a negative spacing to the range floor, quietly', async () => {
                // 0 either way — what the normaliser buys here is the silence, which is
                // the gate's assertion rather than this one's.
                laidOut(<AdwWrapBox childSpacing={-5}>{cells}</AdwWrapBox>, (container) => {
                    expect((find(container, 'AdwWrapBox') as WrapBox).childSpacing).toBe(0);
                });
            });

            await it('takes a negative natural-line-length to the UNSET sentinel, not to 0', async () => {
                laidOut(<AdwWrapBox naturalLineLength={-7}>{cells}</AdwWrapBox>, (container) => {
                    expect((find(container, 'AdwWrapBox') as WrapBox).naturalLineLength).toBe(-1);
                });
            });
        });
    });
};
