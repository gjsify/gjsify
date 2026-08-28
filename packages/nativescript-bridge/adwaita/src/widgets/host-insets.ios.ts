// Who pays a window inset on iOS. Rationale for the split: `host-insets.ts`.
//
// UNVERIFIED ON DEVICE, and deliberately a no-op because of that. There is no iOS runner
// and no Mac in this project (the wall `window-insets-source.ios.ts` and the symbolic
// icon backend already sit behind, #1051), so the Android host's behaviour — measured
// out of a disassembled `widgets-release.aar` — says nothing about this one. What this
// file DOES claim is the weaker statement that the widget's behaviour here is UNCHANGED
// from what shipped before the Android double-payment was measured: the toolbar view
// pays both edges, exactly as it did.
//
// The claim that would need a device is the opposite one — that a UIKit host applies no
// safe-area padding of its own to a NativeScript `Page`, and that the widget therefore
// SHOULD keep paying. It is plausible (NativeScript has no iOS counterpart of
// `LayoutBase`'s `onApplyWindowInsets`; `ui/page/index.ios.ts` has no
// `androidOverflowEdge` twin) but it has not been run. So it is written as "leave iOS
// where it was", not as "iOS is correct" — and if a safe area does turn out to be paid
// twice here, this is the one file that has to change.
//
// The file exists rather than falling back to the base because `nativescript-platforms`
// conformance fails the build when a declared platform loses its variant, and because a
// silent fallback is how `icons.android.ts` once shipped without an iOS twin.

import type { View } from '@nativescript/core';

import { type HostPaidEdges, NO_HOST_PAYMENT, type WindowInsets } from './window-insets.js';

/** Settle which window-inset edges `view` still owes. See {@link resolveHostInsets}. */
export function resolveHostInsets(_view: View, _insets: WindowInsets): HostPaidEdges {
    return NO_HOST_PAYMENT;
}
