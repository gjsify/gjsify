// `AdwOverlaySplitView` — the base module. See `../refuse.ts` for who reaches this and
// why it throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwOverlaySplitViewProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A sidebar beside content, which slides OVER it when collapsed.
 *
 * IT IS NOT `AdwNavigationSplitView` WITH A DIFFERENT PAINT, and the width is where
 * that shows: `resolveOverlaySidebarWidth` caps the RESULT by `width - content_min`
 * where the navigation widget caps the BOUND, and a COLLAPSED overlay ignores the
 * fraction entirely and clamps the VIEW width instead — 280 on a 360-point phone where
 * a quarter would be 180. Both rules are `@gjsify/adwaita-core`'s port of the C, run by
 * the React Native half and by libadwaita itself on GTK.
 */
export function AdwOverlaySplitView(_props: AdwOverlaySplitViewProps): ReactElement | null {
    return refuseBaseModule('AdwOverlaySplitView');
}
