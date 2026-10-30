// The iOS answer to drawing a `Gtk.Label`'s markup as the host's own styled text: none, by
// name. Rationale for the split: `label-markup-native.ts`.
//
// UIKit HAS such text — `NSAttributedString`, with `NSFontAttributeName`,
// `NSUnderlineStyleAttributeName`, `NSBaselineOffsetAttributeName` and a link attribute —
// so unlike `popup-menu-surface.ios.ts` this is not a missing surface but an UNWRITTEN and
// UNRUNNABLE one: there is no iOS runner and no Mac in this project (#1051), and the
// measurement that motivated the Android path (~460 ms of `setSpanModifiers` on a Galaxy
// S9) says nothing about what UIKit's own `Span` path costs. Mapping pango onto attribute
// names without a device would be guessing at both the faithfulness and the win.
//
// Refusing keeps iOS on the `FormattedString` path it already shipped on, which every
// surface has — the behaviour here is UNCHANGED, not "correct". The file exists rather than
// falling back to the base module because the base module's refusal is indistinguishable
// from a silently missing variant, and a silently missing variant is how `icons.android.ts`
// once shipped without an iOS twin.

import type { LabelMarkupNativeText } from './label-markup.js';

/** Record what `label` must draw natively — iOS draws none. See {@link labelMarkupHoldNative}. */
export function labelMarkupHoldNative(_label: object, _text: LabelMarkupNativeText | null): boolean {
    return false;
}

/** Draw the held markup — iOS holds none. See {@link labelMarkupDrawNative}. */
export function labelMarkupDrawNative(_label: object, _reset: boolean): boolean {
    return false;
}
