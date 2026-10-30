// A `Gtk.Label`'s markup drawn as the HOST's OWN styled text, bypassing `FormattedString`
// (ADR 0097 § 2's split, same shape as `popup-menu-surface.ts`).
//
// THIS BASE FILE is for a host that has no such text: it refuses by answering `false`, and
// `gtk-label.ts` then takes the `FormattedString` path, which every surface has. Android's
// `SpannableString` is one, so `label-markup-native.android.ts` answers for it; a consumer
// only ever writes `./label-markup-native.js`. Free of `@nativescript/core` so the widgets
// that call it stay spec-able off a device.
//
// WHY A SECOND PATH AT ALL — MEASURED, not assumed. Learn6502's tutorial page is 146 label
// strings, 99 of which need spans (350 `<tt>`, 24 `<a>`, 19 `<b>`, 6 `<i>`, 1 `<sub>` ≈ 400
// runs). On a Galaxy S9 (API 28) building them as NS `Span`s costs ~460 ms of the page's
// construction, and all of it is inside `setSpanModifiers`: a `Span` is a `ViewBase` with a
// `Style`, so each run allocates a view, resolves CSS against it, then has its resolved
// values read back out and turned into exactly the platform spans this file sets directly.
// Turning the same runs into one `SpannableStringBuilder` skips the view tree and the style
// resolution and leaves the platform spans — which is why the faithfulness does not drop
// with the cost: `labelMarkupFace` in `label-markup.ts` holds the SAME subset of pango the
// `Span` path holds, decided in one pure function so both halves can be asserted off a
// device.
//
// HOLD, THEN WRITE. A label writes `text` once and the platform calls `_setNativeText` from
// inside that write, so the markup has to be held BEFORE the write for the first render to
// be a single native `setText` — holding it after would need a second one. Hence the two
// doors: `labelMarkupHoldNative` records (or clears) what to draw, `labelMarkupDrawNative`
// draws it when the platform asks.

import type { LabelMarkupNativeText } from './label-markup.js';

/**
 * Record the markup `label` must draw natively, or clear it with `null` — answers whether
 * this host draws its own styled text at all, so a caller can take the `FormattedString`
 * path on the same condition it would take it on.
 *
 * A host that answers `true` here MUST answer `true` from {@link labelMarkupDrawNative}
 * for as long as something is held, and the caller may rely on that: nothing re-reads the
 * markup between the hold and the write.
 */
export function labelMarkupHoldNative(_label: object, _text: LabelMarkupNativeText | null): boolean {
    return false;
}

/**
 * Draw the held markup into `label`'s native text view — `false` when there is nothing held
 * or this host has no such text, and then the caller lets `TextBase._setNativeText` run.
 *
 * `reset` is the platform's own "clear the text" call, which no styled text can answer:
 * it is always refused so the base implementation clears the view.
 */
export function labelMarkupDrawNative(_label: object, _reset: boolean): boolean {
    return false;
}
