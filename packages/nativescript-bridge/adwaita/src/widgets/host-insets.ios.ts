// Who pays a window inset on iOS. Rationale for the split: `host-insets.ts`.
//
// VERIFIED ON THE IPHONE 17 SIMULATOR (2026-11-03): the earlier amendment here left the
// widget paying both edges unconditionally, writing that as "unchanged from before", not
// as "iOS is correct" — stating the opposite claim would have needed a device. It needed
// one: Learn6502's Code tab showed ~70pt of dead space between the Dynamic Island (needs
// ~59pt) and the header bar, and roughly double the home indicator's 34pt below the tab
// bar — the Android double-payment's exact shape, on the platform the Android fix never
// reached.
//
// READ OUT OF `@nativescript/core/ui/page/index.ios.js` rather than assumed: `Page`'s
// `onLayout` ALWAYS lays its one child out inside `this.getSafeAreaInsets()` —
// `View.layoutChild(this, this.layoutView, insets.left, insets.top, right - insets.right,
// bottom - insets.bottom)`, unconditionally, with no iOS counterpart of Android's
// `androidOverflowEdge` opt-out. So on iOS the Page pays BOTH edges, always — unlike
// Android, where only the bottom edge is paid until this file hands the top one to the
// toolbar view. The toolbar view must therefore not pay either edge again.
//
// The file exists rather than falling back to the base because `nativescript-platforms`
// conformance fails the build when a declared platform loses its variant, and because a
// silent fallback is how `icons.android.ts` once shipped without an iOS twin.

import type { View } from '@nativescript/core';

import { type HostPaidEdges, type WindowInsets } from './window-insets.js';

/** The Page's `onLayout` pays both edges unconditionally — see the file comment. */
const BOTH_EDGES_PAID: HostPaidEdges = { top: true, bottom: true };

/** Settle which window-inset edges `view` still owes. See {@link resolveHostInsets}. */
export function resolveHostInsets(_view: View, _insets: WindowInsets): HostPaidEdges {
    return BOTH_EDGES_PAID;
}
