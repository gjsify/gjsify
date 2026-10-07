// The system insets as padding on a widget that has to clear them — the platform hook.
//
// `AdwToolbarView` pays the insets for the chrome it owns (top bar, bottom bar). What it cannot
// pay is the content that runs UNDER the gesture area on purpose: a collapsed bottom bar hands
// the bottom edge to the content (`bottomBarShown` in `toolbarViewInsetPadding`), so a pane
// that wants its background painted down to the screen edge, and only its last row clear of
// the pill, pads that row itself. The shared Blueprint cannot say so — GTK has no insets, and
// the `.blp` stays the one both platforms build — and the NativeScript CSS subset has no
// custom property to carry the number, so the app asks for it here, after building.
//
// Off Android the reading is zero, so the call is the same everywhere and pads nothing.

import type { View } from '@nativescript/core';

import { observeWindowInsets } from './window-insets-source.js';
import { padWithInset } from './window-insets.js';

/** Which edges of the widget clear a system bar. */
export interface SystemInsetEdges {
    readonly top?: boolean;
    readonly bottom?: boolean;
}

/**
 * Keep `view`'s padding at its own value plus the live system inset on `edges`
 * (the bottom edge by default). Returns the release, which restores the padding the view had.
 *
 * The padding the view has when this is called is its own: a later write of the same
 * property replaces it until the next inset reading.
 */
export function padForSystemInsets(view: View, edges: SystemInsetEdges = { bottom: true }): () => void {
    const own = { top: view.paddingTop, bottom: view.paddingBottom };
    const detach = observeWindowInsets((insets) => {
        if (edges.top) view.paddingTop = padWithInset(own.top, insets.top);
        // With the keyboard up the toolbar view pays the bottom edge, and the widget must not.
        if (edges.bottom) view.paddingBottom = padWithInset(own.bottom, (insets.ime ?? 0) > 0 ? 0 : insets.bottom);
    });
    return () => {
        detach();
        if (edges.top) view.paddingTop = own.top;
        if (edges.bottom) view.paddingBottom = own.bottom;
    };
}
