// Status-page content visibility for NativeScript — the pure half.
//
// `Adw.StatusPage` has no imperative show/hide code at all: its template binds
// each part's `visible` to a closure over the property that feeds it
// (adw-status-page.ui:23-28, :41-46, :57-62), so an empty title simply is not
// there and the parts below it move up. The NativeScript port instead kept the
// title label permanently in the stack — so an empty title left a blank line —
// and spent about sixty lines of add/remove tree surgery on the OTHER parts to
// achieve what one bound predicate does upstream.
//
// Free of `@nativescript/core` imports — like `icon-path.ts`, `row-press.ts` and
// `chrome.ts` — so the spec suite exercises the shipping predicates rather than a
// transcription of them. The widget class cannot serve that role: it `extends
// GridLayout`, which is unresolvable off-device.
//
// Reference: refs/libadwaita/src/adw-status-page.c (:83-96)
// Reference: refs/libadwaita/src/adw-status-page.ui
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** NativeScript's `visible` / not-in-layout pair, the counterpart of GTK `visible`. */
export type StatusPageVisibility = 'visible' | 'collapse';

/**
 * `string_is_not_empty` (adw-status-page.c:91-96), bound to the `visible` of BOTH
 * the title and the description labels (adw-status-page.ui:41-46, :57-62).
 *
 * It is `string && string[0]` — one byte, no trim. A title of `"   "` is a
 * VISIBLE title in libadwaita, which is why this takes the raw text and never
 * trims it: trimming would hide a widget GTK draws.
 */
export function statusPageLabelVisibility(text: string | null | undefined): StatusPageVisibility {
    return text ? 'visible' : 'collapse';
}

/**
 * `has_image` (adw-status-page.c:83-89), bound to the image's `visible`
 * (adw-status-page.ui:23-28).
 *
 * C is `paintable || (icon_name && icon_name[0])` — two sources, either of which
 * shows the image. This port has no `paintable` counterpart (the icon is an SVG
 * string handed to `AdwIcon`), so only the second half applies; it is kept as its
 * own predicate rather than folded into
 * {@link statusPageLabelVisibility} because upstream really are two different
 * closures, and the missing half is a real gap rather than a simplification.
 */
export function statusPageIconVisibility(icon: string | null | undefined): StatusPageVisibility {
    return icon ? 'visible' : 'collapse';
}
