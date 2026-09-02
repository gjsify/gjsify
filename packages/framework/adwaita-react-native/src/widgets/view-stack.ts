// `AdwViewStack` — the base module. See `../refuse.ts` for who reaches this and why it
// throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwViewStackProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * Named pages, one visible at a time.
 *
 * THE SELECTION IS THE SHARED HALF. Which page an omitted `visible-child-name` shows
 * (the first VISIBLE one, and the auto-pick NOTIFIES), what an unknown name does
 * (nothing — refused, not clamped), and where the selection goes when the visible page
 * is hidden are `@gjsify/adwaita-core`'s `ViewStackState`, held to conformance vectors
 * and already run by both other renderers. On GTK the original answers instead, and
 * the suites assert the same name on both halves.
 */
export function AdwViewStack(_props: AdwViewStackProps): ReactElement | null {
    return refuseBaseModule('AdwViewStack');
}
