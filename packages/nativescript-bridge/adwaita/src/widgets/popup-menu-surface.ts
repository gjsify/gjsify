// The platform half of a `PopupMenu`: the surface a menu is shown on (ADR 0097 § 2).
//
// THIS BASE FILE is for a host that has none. `android.widget.PopupMenu` is Android's, so
// `popup-menu-surface.android.ts` answers for it and `popup-menu-surface.ios.ts` refuses by name;
// a consumer only ever writes `./popup-menu-surface.js`. Free of `@nativescript/core` so the
// widgets that call it can be specced off a device against a recording surface.

import type { PopupMenuSurface } from './popup-menu.js';

/** Open a `PopupMenu` anchored at `anchor` (a `View`). */
export function createPopupMenuSurface(_anchor: object): PopupMenuSurface {
    throw new Error(
        'This platform has no menu surface: menus open an android.widget.PopupMenu anchored at the ' +
            'button (ADR 0097 § 2), and this host is not Android.',
    );
}
