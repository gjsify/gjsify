// Status-page content visibility for NativeScript — the pure half.
//
// `Adw.StatusPage` has no imperative show/hide code at all: its template binds each
// part's `visible` to a closure over the property that feeds it, so an empty title
// is simply not there and the parts below it move up. These two predicates are those
// closures; the widget collapses instead of doing tree surgery.
//
// Free of `@nativescript/core` imports so the spec suite exercises the shipping
// predicates; the widget class `extends GridLayout` and is unresolvable off-device.
//
// Reference: refs/libadwaita/src/adw-status-page.c
// Reference: refs/libadwaita/src/adw-status-page.ui
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

/** NativeScript's `visible` / not-in-layout pair, the counterpart of GTK `visible`. */
export type StatusPageVisibility = 'visible' | 'collapse';

/**
 * `string_is_not_empty`, bound to the `visible` of BOTH the title and the description
 * labels. It is `string && string[0]` — one byte, no trim: a title of `"   "` is a
 * VISIBLE title in libadwaita, so trimming here would hide a widget GTK draws.
 */
export function statusPageLabelVisibility(text: string | null | undefined): StatusPageVisibility {
    return text ? 'visible' : 'collapse';
}

/**
 * `has_image`, bound to the image's `visible`.
 *
 * C is `paintable || (icon_name && icon_name[0])`; this port has no `paintable`
 * counterpart (the icon is an SVG string handed to `AdwIcon`), so only the second
 * half applies. Kept as its own predicate rather than folded into
 * {@link statusPageLabelVisibility} because upstream really are two closures, and
 * the missing half is a real gap rather than a simplification.
 */
export function statusPageIconVisibility(icon: string | null | undefined): StatusPageVisibility {
    return icon ? 'visible' : 'collapse';
}
