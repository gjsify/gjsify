// `AdwBanner` — the base module. See `../refuse.ts` for who reaches this and why it throws
// instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwBannerProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A full-width strip carrying one in-context message and an optional action button.
 *
 * `Adw.Banner` HAS NO ARITHMETIC — its whole specification is five property defaults
 * and three derivations, all of them in `@gjsify/adwaita-core`. The two that are easy to
 * get backwards are the button's visibility (`label && label[0]`, a FIRST-CHARACTER test,
 * so a label of spaces still draws a button) and its mnemonic marker (the template pins
 * the button to `use-underline=True` with no property to turn it off, and pins the TITLE
 * to False, so exactly one of the two strings is stripped).
 */
export function AdwBanner(_props: AdwBannerProps): ReactElement | null {
    return refuseBaseModule('AdwBanner');
}
