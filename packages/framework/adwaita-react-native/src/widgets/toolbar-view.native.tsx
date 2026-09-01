/** @jsxImportSource react */
// `AdwToolbarView` on React Native — three slots in a column. (On the pragma, see
// `bin.native.tsx`.)
//
// THE TREE IS ALWAYS THE SAME THREE VIEWS, whatever the extend flags say, and the flags
// only change the top and bottom slot's STYLE. `@gjsify/adwaita-nativescript` has to move
// its bar boxes between grid rows and then re-append them so they paint over the content,
// because NativeScript paints siblings in add order and its CSS subset has no `z-index`.
// React Native does have one, so an extended bar is `position: 'absolute'` plus
// `zIndex: 1` and stays exactly where it is in the tree — which keeps the tree shape
// stable across a flag flip, so React reconciles three views instead of unmounting two.
//
// `extend-content-to-*-edge` MEANS THE CONTENT SPANS THE FULL HEIGHT AND THE BAR IS DRAWN
// OVER IT, which is what taking the bar out of the flow does: the content `View` is
// `flex: 1` and is then the only thing left in the column.
//
// NEITHER `toolbarViewAllocate` NOR `toolbarViewClasses` RUNS HERE. Why the allocation
// cannot be run honestly, and why the four style classes have nowhere to land, are both
// in `toolbar-view.ts`; `toolbar-view.native.spec.tsx` asserts that the two style props
// reach no style, so the divergence cannot close by accident.

import type { ReactElement } from 'react';
import { View, type ViewStyle } from 'react-native';

import type { AdwToolbarViewProps } from '../props.js';

/** The view itself: the three slots stacked, filling what it is given. */
const VIEW: ViewStyle = { flex: 1, flexDirection: 'column' };

/** The content takes everything the two bars leave. */
const CONTENT: ViewStyle = { flex: 1 };

/** `extend-content-to-top-edge`: out of the flow, pinned to the edge, painted over. */
const OVER_TOP: ViewStyle = { position: 'absolute', top: 0, left: 0, right: 0, zIndex: 1 };

/** `extend-content-to-bottom-edge`, the same at the other edge. */
const OVER_BOTTOM: ViewStyle = { position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 1 };

/** {@link import('./toolbar-view.js').AdwToolbarView} on React Native. */
export function AdwToolbarView({
    children,
    topBar,
    bottomBar,
    extendContentToTopEdge,
    extendContentToBottomEdge,
}: AdwToolbarViewProps): ReactElement | null {
    return (
        <View style={VIEW}>
            <View style={extendContentToTopEdge === true ? OVER_TOP : undefined}>{topBar}</View>
            <View style={CONTENT}>{children}</View>
            <View style={extendContentToBottomEdge === true ? OVER_BOTTOM : undefined}>{bottomBar}</View>
        </View>
    );
}
