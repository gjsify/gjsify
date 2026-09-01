/** @jsxImportSource react */
// The React Native half of `AdwClamp`, rendered through React's real reconciler.
//
// THE NUMBERS IN THIS FILE ARE THE SAME NUMBERS THE GTK HALF IS ASSERTED WITH.
// `clamp.gtk.spec.tsx` puts the real `Adw.Clamp` in a 1000-point window with
// `maximum-size` 400, photographs it, and reads the child back at x=300, width=400 off
// the live GTK tree. This suite renders the React Native module at the same width with
// the same property and asserts `marginStart: 300, width: 400`. That is what "one API
// surface, two implementations" has to mean if it means anything: not two files that
// compile, but two renderers agreeing on a number neither of them invented —
// `@gjsify/adwaita-core`'s port of `adw_clamp_layout_allocate` did.
//
// WHAT IS AND IS NOT MEASURED HERE. `react-test-renderer` runs React's own reconciler
// and its own hook dispatcher, so the state transition through `onLayout` is real. The
// host components are the double (`../testing/react-native.ts`), which is type-pinned
// to React Native's own surface and contributes no numbers. What is absent is Yoga: a
// `width` in a style object is an INSTRUCTION to a layout engine that is not in this
// process. Every assertion below is therefore about what the widget ASKS FOR; the
// matching "and it got it" exists on the GTK side of this package and, for React
// Native, only on a device. The README says exactly this.
//
// THIS BUNDLE IS BUILT WITHOUT `--define 'process.env.NODE_ENV="production"'`, AND
// THAT IS A MEASUREMENT, NOT AN OVERSIGHT. `act()` is what mounts a React 19 test
// renderer at all — `create(element).toJSON()` without it returns `null`, measured, so
// every assertion below would read a tree that was never built. And `act` does not
// exist in React's production build: zero `exports.act` in `react.production.js`, one
// in the development build. `react-test-renderer.production.js` does `var act =
// React.act` and re-exports the `undefined` it got, which makes `import { act }`
// type-check and be `undefined` at call time — a silent failure, and the reason this
// paragraph exists rather than a shrug.
//
// The recipe that mandates the production define elsewhere in this repository names a
// specific cost: `react-reconciler`'s development bundle reaching for `document`,
// `HTMLCanvasElement` and `Path2D`, which makes `--globals auto` pull the GTK-backed
// DOM registers in. Measured against what THIS bundle actually contains — `react`,
// `react-test-renderer` and `@gjsify/adwaita-core`, no `react-reconciler` and no
// `@gjsify/gtk-host` — all three counts are zero. `--exclude-globals navigator` is kept
// because the scheduler's `typeof navigator` probe is in both builds.

import { describe, expect, it } from '@gjsify/unit';
import { act, type ReactTestRendererJSON } from 'react-test-renderer';

import { RCT_VIEW } from '../testing/react-native.js';
import { mount, mounted, onlyChild, type Style } from '../testing/render.spec.js';
import { AdwClamp } from './clamp.native.js';

/** The frame the GTK half is photographed in, so both are asked the same question. */
const FRAME_WIDTH = 1000;

/** Mount, and read the tree BEFORE any layout has been delivered. */
const firstFrame = mounted;

/**
 * Mount, deliver one `onLayout` at `width`, and read the tree the clamp settled on.
 *
 * ONE renderer, read twice — the reason is on `mount` in `../testing/render.spec.ts`.
 */
function settled(element: React.ReactElement, width: number): ReactTestRendererJSON {
    const renderer = mount(element);
    const before = renderer.toJSON() as ReactTestRendererJSON;
    const onLayout = before.props.onLayout as ((event: unknown) => void) | undefined;
    if (typeof onLayout !== 'function') {
        throw new Error('the outer view carries no onLayout, so no size can ever reach the clamp');
    }
    act(() => {
        onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: 100 } } });
    });
    return renderer.toJSON() as ReactTestRendererJSON;
}

export default async () => {
    await describe('AdwClamp on React Native — the tree it emits', async () => {
        await it('is a view inside a view, and the outer one is what measures', async () => {
            const tree = firstFrame(<AdwClamp>{null}</AdwClamp>);
            expect(tree.type).toBe(RCT_VIEW);
            expect(onlyChild(tree).type).toBe(RCT_VIEW);
            expect(typeof tree.props.onLayout).toBe('function');
        });

        await it('leaves the child unclamped before the first layout', async () => {
            const tree = firstFrame(<AdwClamp maximumSize={400}>{null}</AdwClamp>);
            expect(onlyChild(tree).props.style as Style).toBe(undefined);
        });
    });

    await describe('AdwClamp on React Native — the allocation it asks for', async () => {
        await it('clamps and centres exactly where libadwaita does', async () => {
            const child = onlyChild(settled(<AdwClamp maximumSize={400}>{null}</AdwClamp>, FRAME_WIDTH));
            // The GTK photograph of the same case reads x=300, width=400.
            expect(child.props.style as Style).toStrictEqual({ width: 400, marginStart: 300 });
        });

        await it('uses libadwaita’s own default when the property is omitted', async () => {
            const child = onlyChild(settled(<AdwClamp>{null}</AdwClamp>, FRAME_WIDTH));
            expect(child.props.style as Style).toStrictEqual({ width: 600, marginStart: 200 });
        });

        await it('gives a narrow frame ALL of its width — the phone case', async () => {
            // Below the lower threshold the clamp is a pass-through. A `maxWidth`
            // approximation would agree here and disagree in the eased region below,
            // which is why both cases are asserted rather than one.
            const child = onlyChild(settled(<AdwClamp maximumSize={400}>{null}</AdwClamp>, 300));
            expect(child.props.style as Style).toStrictEqual({ width: 300, marginStart: 0 });
        });

        await it('eases between the thresholds instead of snapping to the maximum', async () => {
            // 700 sits inside `lower`=400 … `upper`=1000 for maximumSize 600, where a
            // `maxWidth` would report 600 and libadwaita reports the eased value. The
            // NUMBER is asserted, not a range: `clamp.gtk.spec.tsx` reads 575 at x=62 off
            // the live GTK tree in a 700-point window, so this is the second cross-renderer
            // pair — and the first one that is actually ON the curve. The 1000/400 pair
            // above is not: `tightening-threshold` defaults to 400, so `maximumSize={400}`
            // collapses `lower`, `max` and `upper` onto one another and the easing region
            // has zero width there. Two renderers agreeing at a degenerate point agree
            // about very little.
            const child = onlyChild(settled(<AdwClamp>{null}</AdwClamp>, 700));
            expect(child.props.style as Style).toStrictEqual({ width: 575, marginStart: 62 });
        });
    });

    await describe('AdwClamp on React Native — the property range both halves answer alike', async () => {
        // BOTH halves run `normalizeClampSize` and neither asks GObject to answer this
        // question, because GObject gives one out-of-range value three answers — the
        // measurement is in `clamp.gtk.tsx`.
        //
        // Each row below is asserted against the same authored value in
        // `clamp.gtk.spec.tsx`'s describe of the same name, where it is read off the
        // real widget's property. Before that describe existed the GTK behaviour was a
        // COMMENT here, and it was wrong in both rows.
        await it('truncates a fractional maximum, as an int property does', async () => {
            const child = onlyChild(settled(<AdwClamp maximumSize={400.7}>{null}</AdwClamp>, FRAME_WIDTH));
            expect(child.props.style as Style).toStrictEqual({ width: 400, marginStart: 300 });
        });

        await it('falls back to libadwaita’s default for a value GObject cannot store', async () => {
            // The fallback has to come from the normaliser, because `??` sees a number.
            // GTK reads `maximum-size` back as 600 for the same input.
            const child = onlyChild(settled(<AdwClamp maximumSize={Number.NaN}>{null}</AdwClamp>, FRAME_WIDTH));
            expect(child.props.style as Style).toStrictEqual({ width: 600, marginStart: 200 });
        });

        await it('takes a negative to the range floor, which GTK now reads back as 0', async () => {
            // The child SIZE is 0 here and is the label's intrinsic minimum on GTK —
            // `childMin`, the divergence the README names, not this rule. What both
            // halves agree on is the property: 0.
            const child = onlyChild(settled(<AdwClamp maximumSize={-5}>{null}</AdwClamp>, FRAME_WIDTH));
            expect(child.props.style as Style).toStrictEqual({ width: 0, marginStart: 500 });
        });
    });
};
