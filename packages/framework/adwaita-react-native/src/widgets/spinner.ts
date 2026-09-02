// `AdwSpinner` — the base module. See `../refuse.ts` for who reaches this and why it throws
// instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwSpinnerProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A busy indicator.
 *
 * THE SHARED NUMBERS ARE THE BOX AND THE RING, and they are deliberately two numbers:
 * `adw_spinner_measure` reports `MIN_SIZE` as both the minimum and the natural size with
 * no upper bound, while `adw_spinner_paintable_snapshot_with_weight` caps only the RADIUS
 * and still centres on the box. `@gjsify/adwaita-core`'s `resolveSpinnerSize` and
 * `spinnerGeometry` are that split, and both halves run them.
 *
 * What the React Native half cannot carry is the breathing ARC, and the divergence is
 * named in the README rather than approximated with a rotating quarter-circle — which is
 * a different animation with a different period, and the one thing the core's own header
 * says not to copy.
 */
export function AdwSpinner(_props: AdwSpinnerProps): ReactElement | null {
    return refuseBaseModule('AdwSpinner');
}
