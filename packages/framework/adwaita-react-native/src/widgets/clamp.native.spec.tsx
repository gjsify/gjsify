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
import { act, create, type ReactTestRendererJSON } from 'react-test-renderer';

import { RCT_VIEW } from '../testing/react-native.js';
import { AdwClamp } from './clamp.native.js';

/**
 * React's own opt-in for a test environment.
 *
 * Without it every `act()` prints "The current testing environment is not configured
 * to support act(...)" and React declines to own the flush — the assertions happened
 * to pass anyway, which is the worst version of this: a warning nobody reads standing
 * between the suite and a guarantee it thinks it has.
 */
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** The frame the GTK half is photographed in, so both are asked the same question. */
const FRAME_WIDTH = 1000;

type Style = Record<string, unknown> | undefined;

/** Mount, and read the tree BEFORE any layout has been delivered. */
function firstFrame(element: React.ReactElement): ReactTestRendererJSON {
    let renderer!: ReturnType<typeof create>;
    act(() => {
        renderer = create(element);
    });
    return renderer.toJSON() as ReactTestRendererJSON;
}

/**
 * Mount, deliver one `onLayout` at `width`, and read the tree the clamp settled on.
 *
 * ONE renderer, read twice. Creating a second renderer for the post-layout read would
 * hand back a pre-layout snapshot — the state lives in the first one — and the suite
 * would then assert the unclamped tree while claiming to assert the clamped one.
 */
function settled(element: React.ReactElement, width: number): ReactTestRendererJSON {
    let renderer!: ReturnType<typeof create>;
    act(() => {
        renderer = create(element);
    });
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

const onlyChild = (node: ReactTestRendererJSON): ReactTestRendererJSON => {
    const children = node.children ?? [];
    if (children.length !== 1 || typeof children[0] === 'string') {
        throw new Error(`expected exactly one element child, got ${JSON.stringify(children)}`);
    }
    return children[0] as ReactTestRendererJSON;
};

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
            // `maxWidth` would report 600 and libadwaita reports the eased value.
            const child = onlyChild(settled(<AdwClamp>{null}</AdwClamp>, 700));
            const style = child.props.style as Record<string, number>;
            expect(style.width > 400).toBe(true);
            expect(style.width < 600).toBe(true);
            expect(style.marginStart).toBe(Math.trunc((700 - style.width) / 2));
        });
    });
};
