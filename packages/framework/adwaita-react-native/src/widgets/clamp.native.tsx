/** @jsxImportSource react */
// `AdwClamp` on React Native — libadwaita's easing curve, run in TypeScript.
//
// `@gjsify/adwaita-core`'s `clampAllocate` IS `adw_clamp_layout_allocate`: the same
// three thresholds, the same ease-out-cubic tightening region, the same ceil/floor
// asymmetry and the same C-truncating centring offset. So this file computes the
// number libadwaita would have computed and hands it to Yoga, rather than
// approximating a clamp with `maxWidth` + `alignSelf: 'center'` — which agrees with
// libadwaita at the two ends of the curve and nowhere in the middle, and would make
// the two halves of this package disagree exactly where nobody looks.
//
// THE PROPERTIES GO THROUGH `normalizeClampSize`, NOT `?? default` — and so does the
// GTK half. Both are `g_param_spec_int (…, 0, G_MAXINT, …)`, and the tempting sentence
// "GObject enforces that range, so this half only has to apply the same rule" is false
// as a description of GObject. Measured through `clamp.gtk.tsx` against libadwaita
// 1.9.3: `new Adw.Clamp({'maximum-size': NaN})` STORES 0, `set_property` with that same
// NaN refuses and logs a `GLib-GObject-CRITICAL`, and a negative keeps the previous
// value on both paths and logs one too. One authored value, three answers. So the rule
// lives in `@gjsify/adwaita-core` and BOTH halves run it before anything else sees the
// number; the GTK widget is handed a value it has nothing to refuse.
//
// `?? default` was the first version and it is wrong twice over: `maximumSize={400.7}`
// gave 401 where an int property truncates to 400, and `maximumSize={NaN}` propagated
// the NaN into a `width: NaN` style. `normalizeClampSize` — the same function
// `@gjsify/adwaita-web`'s `<adw-clamp>` and `@gjsify/adwaita-nativescript` already run
// before `clampAllocate` — gives 400 and 600. A fourth private normalisation would be
// the drift, not the fix.
//
// THE SIZE SOURCE IS `onLayout`, NOT `useWindowDimensions()`. Every renderer of this
// design binds to the size of the VIEW, never the window — NativeScript to
// `layoutChanged`, the browser to a `ResizeObserver`, GTK to the widget's own
// allocation. A clamp nested inside a sidebar has to clamp against the sidebar.
//
// WHAT THIS CANNOT DO, AND WHY IT IS WRITTEN DOWN RATHER THAN PAPERED OVER.
// `ClampParams` wants the child's measured minimum and natural size, because
// libadwaita's clamp is a two-pass measure-then-allocate and `childMin` RAISES all
// three thresholds — that is how a child wider than `maximum-size` still gets its
// minimum instead of being cut off. React Native has no such pass: `onLayout` reports
// a size AFTER layout, and never the child's intrinsic minimum at all. So both are
// passed as 0, and the divergence is real and one-directional: a child whose own
// minimum exceeds the clamp gets that minimum on GTK and gets compressed here. The
// README carries it as a named limitation; closing it needs a second measurement pass
// this widget cannot start on its own.

import { useCallback, useState, type ReactElement } from 'react';
import { View, type LayoutChangeEvent } from 'react-native';

import { ADW_CLAMP_DEFAULTS, clampAllocate, normalizeClampSize } from '@gjsify/adwaita-core';

import type { AdwClampProps } from '../props.js';

/**
 * {@link import('./clamp.js').AdwClamp} on React Native.
 *
 * BEFORE THE FIRST LAYOUT there is no available width, so the child is rendered
 * unclamped for exactly one frame. Rendering nothing instead would be worse than it
 * sounds: the outer `View` is what `onLayout` fires on, so an empty first pass still
 * costs the frame AND makes the child's own mount effects run a frame later than they
 * do on GTK.
 */
export function AdwClamp({ children, maximumSize, tighteningThreshold }: AdwClampProps): ReactElement | null {
    const [available, setAvailable] = useState<number | null>(null);

    const onLayout = useCallback((event: LayoutChangeEvent) => {
        setAvailable(event.nativeEvent.layout.width);
    }, []);

    const allocation =
        available === null
            ? null
            : clampAllocate(available, {
                  maximumSize: normalizeClampSize(maximumSize, ADW_CLAMP_DEFAULTS.maximumSize),
                  tighteningThreshold: normalizeClampSize(tighteningThreshold, ADW_CLAMP_DEFAULTS.tighteningThreshold),
                  childMin: 0,
                  childNat: 0,
              });

    return (
        <View onLayout={onLayout} style={{ alignSelf: 'stretch' }}>
            {/* `marginStart` rather than `alignItems: 'center'`: the offset is
                libadwaita's, computed with C integer division, and handing the
                centring to Yoga instead would round it independently. */}
            <View
                style={
                    allocation === null ? undefined : { width: allocation.childSize, marginStart: allocation.offset }
                }
            >
                {children}
            </View>
        </View>
    );
}
