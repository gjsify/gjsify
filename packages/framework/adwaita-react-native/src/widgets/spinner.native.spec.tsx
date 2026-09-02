/** @jsxImportSource react */
// The React Native half of `AdwSpinner`, rendered through React's real reconciler.
//
// THE BOX AND THE RING ARE TWO NUMBERS AND THIS FILE ASSERTS BOTH. `content.gtk.spec.tsx`
// can only ask the real `Adw.Spinner` about the BOX — the ring is painted by
// `AdwSpinnerPaintable` and is not a node in the GTK tree at all — so the shared pair is
// the box (200 measured on GTK, 200 asked for here) and the ring is asserted where it IS a
// node, which is here. That asymmetry is named in the README rather than papered over with
// a rasterisation that would only say "something was drawn".
//
// THE RING'S THREE RULES, each with a case: the shorter side decides the radius and it is
// FLOORED, so a 31-point box draws a 30-point ring; the radius is capped at 32 while the
// centre still follows the box, so 200 draws 64; and the stroke is `diameter / 8` exactly,
// so 200 gives 8 and 31 gives 3.75. A renderer that took the radius from the box without
// the cap would agree with GTK at 16 and 24 and nowhere above 64.
//
// The harness — `act`, the renderer, the child readers — is `../testing/render.spec.ts`.
//
// WHAT IS DELIBERATELY ABSENT is the arc. The drawn circle is the TRACK —
// `ADW_SPINNER_TRACK_OPACITY`, the widget's colour at 15%, which is exactly what the
// browser renderer paints under its arc — and there is no breathing segment on top of it,
// because drawing one needs a path renderer this package does not depend on. Asserting the
// track's opacity is what keeps that from silently becoming a solid ring.

import { describe, expect, it } from '@gjsify/unit';

import { RCT_VIEW } from '../testing/react-native.js';
import { mounted, onlyChild, type Style } from '../testing/render.spec.js';
import { AdwSpinner } from './spinner.native.js';

/** The box `content.gtk.spec.tsx` measures the real widget at. */
const SPINNER_BOX = 200;

export default async () => {
    await describe('AdwSpinner on React Native — the box', async () => {
        await it('is libadwaita’s natural 16 with no request, as the widget measures', async () => {
            // `content.gtk.spec.tsx` reads `measure(HORIZONTAL, -1)[0] === 16` off a real
            // `Adw.Spinner` with no request. `resolveSpinnerSize(undefined)` is the same
            // 16, because `adw_spinner_measure` reports MIN_SIZE as minimum AND natural.
            const tree = mounted(<AdwSpinner />);
            expect(tree.type).toBe(RCT_VIEW);
            const style = tree.props.style as Record<string, unknown>;
            expect(style.width).toBe(16);
            expect(style.height).toBe(16);
        });

        await it('treats GTK’s own -1 “no request” as that same 16', async () => {
            // Not a coincidence to be tidied away later: `-1` is what `width-request`
            // holds when nothing asked, so the two halves have to answer alike for it.
            const style = mounted(<AdwSpinner widthRequest={-1} heightRequest={-1} />).props.style as Record<
                string,
                unknown
            >;
            expect(style.width).toBe(16);
            expect(style.height).toBe(16);
        });

        await it('keeps an oversized request oversized — there is no upper bound on the box', async () => {
            const style = mounted(<AdwSpinner widthRequest={SPINNER_BOX} heightRequest={SPINNER_BOX} />).props
                .style as Record<string, unknown>;
            expect(style.width).toBe(SPINNER_BOX);
            expect(style.height).toBe(SPINNER_BOX);
        });
    });

    await describe('AdwSpinner on React Native — the ring, which is where the cap lives', async () => {
        await it('draws a 64-point ring with an 8-point stroke inside a 200-point box', async () => {
            const ring = onlyChild(mounted(<AdwSpinner widthRequest={SPINNER_BOX} heightRequest={SPINNER_BOX} />));
            expect(ring.props.style as Style).toStrictEqual({
                width: 64,
                height: 64,
                borderRadius: 32,
                borderWidth: 8,
                opacity: 0.15,
            });
        });

        await it('floors the radius, so a 31-point box draws a 30-point ring', async () => {
            // `Math.floor(31 / 2) * 2`. The stroke follows the DRAWN diameter, not the
            // box, so it is 3.75 and not 3.875.
            const ring = onlyChild(mounted(<AdwSpinner widthRequest={31} heightRequest={31} />));
            expect(ring.props.style as Style).toStrictEqual({
                width: 30,
                height: 30,
                borderRadius: 15,
                borderWidth: 3.75,
                opacity: 0.15,
            });
        });

        await it('takes the SHORTER side, so an oblong box draws the smaller ring', async () => {
            const ring = onlyChild(mounted(<AdwSpinner widthRequest={SPINNER_BOX} heightRequest={24} />));
            expect((ring.props.style as Record<string, unknown>).width).toBe(24);
            expect((ring.props.style as Record<string, unknown>).borderWidth).toBe(3);
        });
    });

    await describe('AdwSpinner on React Native — what it announces', async () => {
        await it('is a busy progressbar, which both earlier renderers shipped without', async () => {
            // `gtk_widget_class_set_accessible_role (…, PROGRESS_BAR)` plus
            // `GTK_ACCESSIBLE_STATE_BUSY, TRUE`. A repo-wide grep for either found ZERO
            // hits across the two other ports before they were fixed, so a screen reader
            // was told nothing at all.
            const tree = mounted(<AdwSpinner />);
            expect(tree.props.accessibilityRole).toBe('progressbar');
            expect(tree.props.accessibilityState).toStrictEqual({ busy: true });
        });
    });
};
