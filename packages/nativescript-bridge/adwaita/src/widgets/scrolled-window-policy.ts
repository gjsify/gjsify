// `Gtk.PolicyType` for `Gtk.ScrolledWindow`, reduced to what an NS `ScrollView` can do.
//
// A `GtkScrolledWindow` scrolls on BOTH axes, each under its own policy. A NativeScript
// `ScrollView` scrolls on ONE (`orientation`), so the two policies have to be folded into the
// one axis the view can honour. The fold is lossy in exactly one case, and it is declared in
// `check-nativescript-widget-coverage.mjs` rather than hidden: a window that scrolls on both
// axes scrolls vertically only.
//
//   · `never` on an axis means the child is held to the viewport on that axis (a wrapping
//     label wraps instead of growing a scrollbar) — which is what a `ScrollView` already does
//     on its cross axis.
//   · `external` scrolls without drawing a scrollbar, and `always` draws one the platform
//     decides on its own; neither changes WHETHER the axis scrolls, so both count as
//     scrolling here.
//
// Reference: refs/gtk gtk/gtkenums.h (GtkPolicyType), gtk/gtkscrolledwindow.c
// Copyright (c) The GTK Team. LGPLv2.1+.

export const GTK_POLICY_TYPES = ['always', 'automatic', 'never', 'external'] as const;

export type GtkPolicyNick = (typeof GTK_POLICY_TYPES)[number];

/** `gtk_scrolled_window_init`: both policies start `automatic`. */
export const DEFAULT_SCROLLBAR_POLICY: GtkPolicyNick = 'automatic';

/** The nick a policy write means — a nick or the constant — or throw, naming the members. */
export function normalizePolicy(value: unknown, property: 'hscrollbar-policy' | 'vscrollbar-policy'): GtkPolicyNick {
    if (typeof value === 'number' && Number.isInteger(value) && GTK_POLICY_TYPES[value] !== undefined) {
        return GTK_POLICY_TYPES[value]!;
    }
    if (typeof value === 'string') {
        const nick = value.trim();
        const found = GTK_POLICY_TYPES.find((member) => member === nick);
        if (found !== undefined) return found;
    }
    throw new TypeError(
        `'${String(value)}' is not a Gtk.PolicyType, so it cannot be '${property}'. ` +
            `The members are ${GTK_POLICY_TYPES.join(', ')}.`,
    );
}

/** Whether an axis under `policy` scrolls at all. */
export function policyScrolls(policy: GtkPolicyNick): boolean {
    return policy !== 'never';
}

/**
 * The one axis the `ScrollView` scrolls on, for a pair of policies.
 *
 * Vertical wins a tie, because that is the axis a page of content grows on; a window that
 * scrolls ONLY horizontally is the one case that flips it. Neither axis scrolling still
 * answers `vertical` — a `ScrollView` cannot refuse to scroll, so the child is simply held
 * at its natural size by the surrounding layout.
 */
export function scrollOrientationFor(
    hscrollbarPolicy: GtkPolicyNick,
    vscrollbarPolicy: GtkPolicyNick,
): 'horizontal' | 'vertical' {
    return policyScrolls(hscrollbarPolicy) && !policyScrolls(vscrollbarPolicy) ? 'horizontal' : 'vertical';
}
