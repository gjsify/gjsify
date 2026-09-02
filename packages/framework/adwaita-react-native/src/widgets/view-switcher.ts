// `AdwViewSwitcher` — the base module. See `../refuse.ts` for who reaches this and why
// it throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwViewSwitcherProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A row of buttons over a view stack.
 *
 * WHAT EACH BUTTON SHOWS IS DERIVED, NOT AUTHORED, and that derivation is
 * `@gjsify/adwaita-core`'s `buildViewSwitcherButtons`: a page with NEITHER a title NOR
 * an icon has no button at all, a page with no icon gets `image-missing` rather than
 * nothing, a badge above 999 reads `999+`, and the button's orientation follows the
 * policy. libadwaita computes the same on GTK, so this widget's two halves differ in
 * what they can DRAW and never in which buttons exist.
 */
export function AdwViewSwitcher(_props: AdwViewSwitcherProps): ReactElement | null {
    return refuseBaseModule('AdwViewSwitcher');
}
