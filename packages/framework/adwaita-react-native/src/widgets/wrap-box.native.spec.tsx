/** @jsxImportSource react */
// The React Native half of `AdwWrapBox`, rendered through React's real reconciler.
//
// EVERY NUMBER BELOW COMES FROM `@gjsify/adwaita-core`, and two of them are the ones a
// renderer gets wrong on its own:
//
//   `wrapPolicy` DEFAULTS TO `natural`, which is `flex-shrink: 0` — and CSS and Yoga both
//   default `flex-shrink` to 1, i.e. to `minimum`. A renderer that writes no policy
//   silently draws the one Adwaita does not choose, so the default is asserted as 0.
//
//   A BOX WITH ONE CHILD is a box whose only line is the LAST one, so `justify` does not
//   govern it — `justify-last-line` does, and `spread` STRETCHES a lone child instead of
//   spreading anything (C guards the keep-at-minimum branch with `n_children > 1`). That
//   is the common box and the counter-intuitive answer, and it is why the per-child
//   factors come from `wrapBoxChildFlex` rather than off the container's answer.
//
// THE UNITS ARE ASSERTED IN PIXELS, not passed through: `child-spacing` 12 in `pt` at the
// default 96 dpi is 16 px, which is `adw_length_unit_to_px`'s 4/3 and not a rounding.
//
// A WRAPPER `View` PER CHILD IS PART OF THE CONTRACT, not an implementation detail —
// `flex-grow` and `flex-shrink` belong to the child and this component does not own its
// children's styles. `wrap-box.native.tsx` says why `cloneElement` is not the way out.
//
// The harness — `act`, the renderer, the child readers — is `../testing/render.spec.ts`.

import { describe, expect, it } from '@gjsify/unit';

import { RCT_VIEW, View } from '../testing/react-native.js';
import { at, childrenOf, mounted, type Style } from '../testing/render.spec.js';
import { AdwWrapBox } from './wrap-box.native.js';

/** Three children, so a line is a line rather than the lone-child special case. */
const cells = ['one', 'two', 'three'].map((id) => <View key={id} testID={id} />);

/** The container style of one mounted wrap box. */
const boxStyle = (element: React.ReactElement): Style => mounted(element).props.style as Style;

/** The wrapper style every child carries — the same object for all of them. */
function childStyle(element: React.ReactElement): Style {
    const wrappers = childrenOf(mounted(element));
    const styles = wrappers.map((wrapper) => JSON.stringify(wrapper.props.style));
    expect(new Set(styles).size).toBe(1);
    return at(wrappers, 0).props.style as Style;
}

/** The default container answer, so a row states only what it varies. */
const BASE = {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-start',
    alignContent: 'flex-start',
    alignItems: 'stretch',
    columnGap: 0,
    rowGap: 0,
};

export default async () => {
    await describe('AdwWrapBox on React Native — the tree it emits', async () => {
        await it('wraps every child in a View that carries the flex factors', async () => {
            const tree = mounted(<AdwWrapBox>{cells}</AdwWrapBox>);
            expect(tree.type).toBe(RCT_VIEW);
            const wrappers = childrenOf(tree);
            expect(wrappers.length).toBe(3);
            expect(wrappers.map((wrapper) => wrapper.type)).toStrictEqual([RCT_VIEW, RCT_VIEW, RCT_VIEW]);
            expect(wrappers.map((wrapper) => at(childrenOf(wrapper), 0).props.testID)).toStrictEqual([
                'one',
                'two',
                'three',
            ]);
        });

        await it('is a wrapping row at libadwaita’s defaults, with no gaps', async () => {
            expect(boxStyle(<AdwWrapBox>{cells}</AdwWrapBox>)).toStrictEqual(BASE);
        });
    });

    await describe('AdwWrapBox on React Native — the spacings and their units', async () => {
        await it('puts child-spacing along the line and line-spacing between lines', async () => {
            expect(
                boxStyle(
                    <AdwWrapBox childSpacing={12} lineSpacing={6}>
                        {cells}
                    </AdwWrapBox>,
                ),
            ).toStrictEqual({ ...BASE, columnGap: 12, rowGap: 6 });
        });

        await it('flips which gap is which when the orientation does', async () => {
            expect(
                boxStyle(
                    <AdwWrapBox orientation="vertical" childSpacing={12} lineSpacing={6}>
                        {cells}
                    </AdwWrapBox>,
                ),
            ).toStrictEqual({ ...BASE, flexDirection: 'column', columnGap: 6, rowGap: 12 });
        });

        await it('resolves each spacing through its OWN unit — 12pt is 16px at 96 dpi', async () => {
            // `adw_length_unit_to_px`: `pt` is `value * dpi / 72`, `sp` a passthrough at
            // 96. The two spacings can legitimately disagree about the unit, which is why
            // they are two properties and not one.
            expect(
                boxStyle(
                    <AdwWrapBox childSpacing={12} childSpacingUnit="pt" lineSpacing={6} lineSpacingUnit="sp">
                        {cells}
                    </AdwWrapBox>,
                ),
            ).toStrictEqual({ ...BASE, columnGap: 16, rowGap: 6 });
        });

        await it('caps the main axis at natural-line-length, and only when it is set', async () => {
            // The DELIBERATE DEVIATION `@gjsify/adwaita-web` records too: libadwaita caps
            // the NATURAL size request and leaves a larger allocation free to happen, and
            // neither CSS nor Yoga can cap only the intrinsic contribution.
            expect(boxStyle(<AdwWrapBox naturalLineLength={300}>{cells}</AdwWrapBox>)).toStrictEqual({
                ...BASE,
                maxWidth: 300,
            });
            expect(
                boxStyle(
                    <AdwWrapBox orientation="vertical" naturalLineLength={300}>
                        {cells}
                    </AdwWrapBox>,
                ),
            ).toStrictEqual({ ...BASE, flexDirection: 'column', maxHeight: 300 });
            // `-1` is the UNSET sentinel, not a length: no cap at all.
            expect(boxStyle(<AdwWrapBox naturalLineLength={-1}>{cells}</AdwWrapBox>)).toStrictEqual(BASE);
        });
    });

    await describe('AdwWrapBox on React Native — the line decision', async () => {
        await it('reads align as a MAIN-axis offset, snapped to flexbox’s three positions', async () => {
            expect(boxStyle(<AdwWrapBox align={0.5}>{cells}</AdwWrapBox>)?.justifyContent).toBe('center');
            expect(boxStyle(<AdwWrapBox align={1}>{cells}</AdwWrapBox>)?.justifyContent).toBe('flex-end');
            // GObject clamps `align` into [0, 1]; the GTK half asserts the same input
            // reaching the real widget as 1.
            expect(boxStyle(<AdwWrapBox align={2}>{cells}</AdwWrapBox>)?.justifyContent).toBe('flex-end');
        });

        await it('grows the children for fill and the gaps for spread', async () => {
            expect(boxStyle(<AdwWrapBox justify="fill">{cells}</AdwWrapBox>)?.justifyContent).toBe('flex-start');
            expect(childStyle(<AdwWrapBox justify="fill">{cells}</AdwWrapBox>)).toStrictEqual({
                flexGrow: 1,
                flexShrink: 0,
            });
            expect(boxStyle(<AdwWrapBox justify="spread">{cells}</AdwWrapBox>)?.justifyContent).toBe('space-between');
            expect(childStyle(<AdwWrapBox justify="spread">{cells}</AdwWrapBox>)).toStrictEqual({
                flexGrow: 0,
                flexShrink: 0,
            });
        });

        await it('leaves a LONE child to justify-last-line, where spread STRETCHES it', async () => {
            // The single-child box is the common one and the counter-intuitive one: its
            // only line is the final line, so `justify` alone does nothing to it.
            expect(childStyle(<AdwWrapBox justify="fill">{cells[0]}</AdwWrapBox>)).toStrictEqual({
                flexGrow: 0,
                flexShrink: 0,
            });
            expect(
                childStyle(
                    <AdwWrapBox justify="spread" justifyLastLine={true}>
                        {cells[0]}
                    </AdwWrapBox>,
                ),
            ).toStrictEqual({ flexGrow: 1, flexShrink: 0 });
        });

        await it('reverses the pack direction and the wrap direction on their own axes', async () => {
            expect(boxStyle(<AdwWrapBox packDirection="end-to-start">{cells}</AdwWrapBox>)?.flexDirection).toBe(
                'row-reverse',
            );
            expect(
                boxStyle(
                    <AdwWrapBox orientation="vertical" packDirection="end-to-start">
                        {cells}
                    </AdwWrapBox>,
                )?.flexDirection,
            ).toBe('column-reverse');
            expect(boxStyle(<AdwWrapBox wrapReverse={true}>{cells}</AdwWrapBox>)?.flexWrap).toBe('wrap-reverse');
            expect(boxStyle(<AdwWrapBox lineHomogeneous={true}>{cells}</AdwWrapBox>)?.alignContent).toBe('stretch');
        });

        await it('defaults wrap-policy to natural, which is NOT the flexbox default', async () => {
            expect(childStyle(<AdwWrapBox>{cells}</AdwWrapBox>)).toStrictEqual({ flexGrow: 0, flexShrink: 0 });
            expect(childStyle(<AdwWrapBox wrapPolicy="minimum">{cells}</AdwWrapBox>)).toStrictEqual({
                flexGrow: 0,
                flexShrink: 1,
            });
        });
    });

    await describe('AdwWrapBox on React Native — the property range both halves answer alike', async () => {
        await it('takes a negative spacing to the range floor', async () => {
            expect(boxStyle(<AdwWrapBox childSpacing={-5}>{cells}</AdwWrapBox>)).toStrictEqual(BASE);
        });

        await it('takes a negative natural-line-length to the UNSET sentinel, not to 0', async () => {
            // A 0 cap would be a box of zero width. The GTK half reads the same input
            // back off `Adw.WrapBox` as -1.
            expect(boxStyle(<AdwWrapBox naturalLineLength={-7}>{cells}</AdwWrapBox>)).toStrictEqual(BASE);
        });
    });
};
