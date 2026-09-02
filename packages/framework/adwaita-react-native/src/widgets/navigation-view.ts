// `AdwNavigationView` — the base module. See `../refuse.ts` for who reaches this and
// why it throws instead of resolving to something.

import type { ReactElement } from 'react';

import type { AdwNavigationViewProps } from '../props.js';
import { refuseBaseModule } from '../refuse.js';

/**
 * A stack of pages, one visible at a time.
 *
 * THE TWO IMPLEMENTATIONS SHARE THE STACK MACHINE AND NOTHING ELSE, and unlike every
 * widget above this one that machine is real state rather than arithmetic: a page
 * registry, a tag index, the static-versus-dynamic `remove_on_pop` lifecycle, six
 * mutators and the back-button derivation. On GTK it is libadwaita's own C; on React
 * Native it is `@gjsify/adwaita-core`'s `NavigationViewState`, the same class
 * `@gjsify/adwaita-web` and `@gjsify/adwaita-nativescript` already run — so the three
 * renderers answer one question about a given page chain, and the suites assert the
 * same tag and the same tooltip on both halves rather than each side's own idea of
 * "the top of the stack".
 */
export function AdwNavigationView(_props: AdwNavigationViewProps): ReactElement | null {
    return refuseBaseModule('AdwNavigationView');
}
