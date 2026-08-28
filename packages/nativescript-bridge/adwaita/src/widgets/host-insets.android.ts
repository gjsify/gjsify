// Who pays a window inset on Android. Rationale for the split: `host-insets.ts`.
//
// WHAT THE HOST DOES, read out of `org.nativescript.widgets.LayoutBase` in
// `@nativescript/core/platforms/android/widgets-release.aar` rather than assumed:
//
//   - `setPadding(l,t,r,b)` forwards `l+edgeInsets.left … b+edgeInsets.bottom` to
//     `ViewGroup.setPadding`, so a LayoutBase's padding is always the app's value PLUS
//     whatever insets it decided to pay.
//   - `LayoutBase$2.onApplyWindowInsets` returns early when the insets are consumed or
//     `overflowEdge == -1`. At `overflowEdge == 0` it pays every edge, with
//     `max(systemBars.bottom, ime.bottom)` at the bottom, and reports systemBars AND ime
//     as `Insets.NONE` to its children. Any other value reads per-edge bits: `top`
//     (1 << 2) means "let the content overflow the top edge", i.e. do not pay it — and
//     the bottom keeps its `max(systemBars, ime)`, which is the whole reason this file
//     asks for `'top'` and not for `'top,bottom'`.
//   - `setOverflowEdge` calls `ViewCompat.requestApplyInsets`, or defers to the next
//     attach, so it takes effect whenever it is called.
//
// `Page` is the ONLY NS view on the paying branch: `ui/page/index.android.js` sets
// `androidOverflowEdge = 'none'`, while `ContainerView` — which every NS layout
// including this widget's `GridLayout` descends from — sets `'ignore'`.
//
// The assumption is not left standing: this file WRITES the page's `androidOverflowEdge`
// rather than reading it, so "the page pays the bottom and not the top" is true because
// this made it true, whatever the app had set. What it cannot cover is a toolbar view
// that is later removed from a page it changed — non-Adwaita content left behind then
// sits under the clock. No showcase does that, and the alternative (restoring the old
// value on unload) would fight the other pane's identical write.

import type { View } from '@nativescript/core';

import { type HostPaidEdges, NO_HOST_PAYMENT, type WindowInsets } from './window-insets.js';

/**
 * The page pays the bottom edge — with the keyboard folded into it — and, after the
 * write below, nothing at the top.
 */
const PAGE_PAYS_THE_BOTTOM: HostPaidEdges = { top: false, bottom: true };

/** `CoreTypes.AndroidOverflow`: let the content overflow the top edge, pay the rest. */
const OVERFLOW_TOP = 'top';

/** Settle which window-inset edges `view` still owes. See {@link resolveHostInsets}. */
export function resolveHostInsets(view: View, insets: WindowInsets): HostPaidEdges {
    // No page above us — a view shown modally on its own, or one not mounted yet.
    // Nothing is paying, so the widget owes both edges, which is what it already does.
    const page = view.page;
    if (!page) return NO_HOST_PAYMENT;

    // Only take the top edge off the page once there is a reading to pay it WITH.
    // A widget whose reading is stuck at zero would otherwise release an inset nobody
    // then pays, and content would sit under the clock — strictly worse than the
    // doubled band this file exists to remove. That is not hypothetical: the showcase
    // bundle carries 31 modules of this package TWICE, once per symlink path the
    // resolver saw, so there are two `WindowInsetsBroadcast` singletons and
    // `setOnApplyWindowInsetsListener` REPLACES rather than adds — whichever copy
    // installs last owns the reading and the other's subscribers stay at zero forever.
    // Re-reading the guard on every application also covers a view re-attached to a
    // different page, which a one-shot at `loaded` would not.
    if (insets.top > 0 && page.androidOverflowEdge !== OVERFLOW_TOP) page.androidOverflowEdge = OVERFLOW_TOP;
    return PAGE_PAYS_THE_BOTTOM;
}
