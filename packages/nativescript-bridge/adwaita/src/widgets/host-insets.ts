// Who pays a window inset when the HOST already pays some of it.
//
// `toolbarViewInsetPadding` answers "which SLOT of a toolbar view absorbs which edge".
// It cannot answer the question above it — whether the edge is still owing at all —
// because that is a fact about the host the widget is mounted in, and the host differs
// per platform. Keeping the two apart is what lets the slot arithmetic stay pure.
//
// THE INCIDENT. On Android the inset was paid TWICE. NativeScript's `Page` sets
// `androidOverflowEdge = 'none'` (`ui/page/index.android.js`), which puts its native
// `org.nativescript.widgets.LayoutBase` on the branch that adds the system-bar insets to
// its own padding — while every other NS layout sets `'ignore'` and pays nothing. The
// toolbar view then added the same reading again. Measured on emulator-5554 (1080x2424,
// 420 dpi): 142 px of page padding + 142 px of top-bar padding above the header bar,
// and 63 px + 63 px below the content — 108 dp of dead chrome at the top, 48 dp at the
// bottom, against GTK and browser twins that have neither.
//
// The two edges do NOT get the same answer, and the reason is measurable rather than
// aesthetic:
//
//   - TOP: the band the page pays is painted by the PAGE background; the band the
//     toolbar view pays is painted by `.adw-toolbar-view-top`, i.e. the header colour.
//     Those differ in every scheme this theme ships (light sidebar #ebebed over a
//     #fafafb window; dark #2e2e32 over #222226), so letting the page pay it puts a
//     mismatched stripe between the clock and the header — the exact defect fixed one
//     level down. The toolbar view is the only payer that can paint it right, so the
//     HOST has to stop paying this edge.
//   - BOTTOM: the page's payer is the only one that also carries the KEYBOARD.
//     `LayoutBase$2.onApplyWindowInsets` pays `max(systemBars.bottom, ime.bottom)`, and
//     only on the branch that pays the system bars at all. Taking that edge away from
//     the page takes the IME with it: the window then pans instead of resizing, the
//     header bar leaves the screen and the focused field slides under the keyboard.
//     So the TOOLBAR VIEW stops paying this edge.
//
// The platform variants beside this file (`.android.ts`, `.ios.ts`) each answer for
// their host; a consumer only ever writes `./host-insets.js`.
//
// THIS BASE FILE is for a host that is neither: nothing above the widget applies an
// inset, so the widget owes both edges — the behaviour every platform had before the
// Android half was measured.

import type { View } from '@nativescript/core';

import { type HostPaidEdges, NO_HOST_PAYMENT, type WindowInsets } from './window-insets.js';

/**
 * Settle which window-inset edges `view` still owes, adjusting the host where the
 * widget paints an edge better than the host can.
 *
 * Takes the READING as well as the view, and is called on every inset application
 * rather than once at `loaded`, because an Android variant that hands an edge back to
 * the host must not do so before it holds a reading to pay that edge with. Idempotent:
 * a page with two toolbar views resolves twice, and a view re-attached to another page
 * resolves again.
 */
export function resolveHostInsets(_view: View, _insets: WindowInsets): HostPaidEdges {
    return NO_HOST_PAYMENT;
}
