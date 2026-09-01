/** @jsxImportSource react */
// `AdwSpinner` on React Native. (On the pragma, see `bin.native.tsx`.)
//
// THE TWO NUMBERS ARE THE CORE'S, AND THEY ARE TWO ON PURPOSE. `resolveSpinnerSize` is
// `adw_spinner_measure`'s floor — 16 is reported as both the minimum and the natural size,
// so a smaller request is not representable and an unset one IS 16, which is also what
// GTK's own `-1` "no request" produces. `spinnerGeometry` is the paintable: the SHORTER
// side decides the radius, it is FLOORED (a 31-point box draws a 30-point ring), it is
// capped at 32 while the CENTRE still follows the box, and the stroke is `diameter / 8`
// exactly. So a 200-point request occupies 200 points of layout around a 64-point ring
// with an 8-point stroke — the split the two other renderers each had to be taught.
//
// WHAT IS DRAWN IS THE TRACK, AND ONLY THE TRACK. `AdwSpinnerPaintable`'s arc extends,
// overlaps, contracts and idles on an ease-in-out-sine while the whole figure turns, and
// drawing it needs a path renderer — `react-native-svg` or a canvas, neither of which is
// a dependency of this package, and neither of which core React Native supplies. The
// honest subset is the circle underneath it: `CIRCLE_OPACITY` of the current colour, which
// is `ADW_SPINNER_TRACK_OPACITY` and is exactly what the browser renderer paints under its
// arc. What is NOT done is the `_spinner.scss` substitute — a fixed 90-degree
// `border-top-color` chase at 0.8s — because that is a different animation with a
// different period, and copying it would put a wrong number where there is currently an
// absent one. The README names the gap.
//
// `ActivityIndicator` IS NOT USED, and that is a decision about the TEST DOUBLE rather
// than about the phone. `@gjsify/adwaita-nativescript` reaches for the platform indicator
// for good reasons, and the same reasoning would apply here — but React Native's
// `ActivityIndicator` is a COMPOSITE that wraps a native node in a `View`, branches on
// `Platform.OS` and moves a numeric `size` into a style. `testing/react-native.ts` stands
// in only for components that ARE a host element with their props forwarded, so doubling
// it would mean asserting a nesting and a prop placement real React Native does not
// produce.

import type { ReactElement } from 'react';
import { View } from 'react-native';

import { ADW_SPINNER_TRACK_OPACITY, resolveSpinnerSize, spinnerGeometry } from '@gjsify/adwaita-core';

import type { AdwSpinnerProps } from '../props.js';

/** {@link import('./spinner.js').AdwSpinner} on React Native. */
export function AdwSpinner({ widthRequest, heightRequest }: AdwSpinnerProps): ReactElement | null {
    const width = resolveSpinnerSize(widthRequest);
    const height = resolveSpinnerSize(heightRequest);
    const { diameter, lineWidth } = spinnerGeometry(width, height);

    return (
        <View
            // `gtk_widget_class_set_accessible_role (…, PROGRESS_BAR)` plus
            // `GTK_ACCESSIBLE_STATE_BUSY, TRUE`. Both renderers before this one shipped
            // without either and announced nothing at all to a screen reader.
            accessibilityRole="progressbar"
            accessibilityState={{ busy: true }}
            style={{ width, height, alignItems: 'center', justifyContent: 'center' }}
        >
            <View
                style={{
                    width: diameter,
                    height: diameter,
                    borderRadius: diameter / 2,
                    borderWidth: lineWidth,
                    opacity: ADW_SPINNER_TRACK_OPACITY,
                }}
            />
        </View>
    );
}
