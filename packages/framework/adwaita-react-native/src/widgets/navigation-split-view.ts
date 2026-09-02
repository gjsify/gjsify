// `AdwNavigationSplitView` — the base module. See `../refuse.ts` for who reaches this
// and why it throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwNavigationSplitViewProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A sidebar beside content, which becomes a navigation stack when collapsed.
 *
 * THE SHARED HALF IS TWO THINGS, and both are `@gjsify/adwaita-core`'s. The WIDTH is
 * `resolveNavigationSidebarWidth`, a port of the C that caps the sidebar's MAX BOUND by
 * `width - content_min` and then clamps with GLib's `CLAMP` — which tests the high
 * bound first and therefore disagrees with `Math.min(max, Math.max(min, x))` exactly
 * where the bounds invert. The ORDERING is `resolveNavigationStack`, the table that
 * keeps a LONE child visible whatever `show-content` says and makes the CONTENT the
 * root page under `sidebar-position: end`. libadwaita runs the originals on GTK; the
 * React Native half runs the ports, and the suites assert the same numbers on both.
 */
export function AdwNavigationSplitView(_props: AdwNavigationSplitViewProps): ReactElement | null {
    return refuseBaseModule('AdwNavigationSplitView');
}
