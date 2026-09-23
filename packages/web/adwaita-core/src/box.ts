// `Gtk.Box` — the two property readings every renderer of it needs, headless.
//
// NO STATE MACHINE, by ADR 0004's rule for trivial behaviour: a box stacks its children
// along one axis with a gap between them, and each renderer already has a layout that
// does the stacking (a flex row on the web, a `StackLayout` on NativeScript). What the
// renderers must NOT each decide for themselves is how an authored value becomes the
// property GTK would hold — that is where two ports drift, and it lives here once.
//
// Reference: refs/gtk/gtk/gtkbox.c (the `spacing` pspec: an int, minimum 0, default 0)
// Reference: refs/gtk/gtk/gtkorientable.c (`orientation`, default horizontal)
// Copyright (c) The GTK Team. LGPLv2.1+.

/** `Gtk.Box:spacing`'s default — `0` in the pspec. */
export const DEFAULT_BOX_SPACING = 0;

/** `Gtk.Orientation`'s two nicks — the value `orientation` takes on every surface. */
export type BoxOrientation = 'horizontal' | 'vertical';

/**
 * A spacing value as the box will hold it: a finite, non-negative number.
 *
 * The pspec's minimum is 0, and a negative write lands there — measured on `Gtk.Box`
 * under gjs 1.88.1 / gtk 4.22.4 (`conformance/box.ts` records the rows).
 * A box that pulled its children together would look like a theme bug, not a refusal.
 */
export function normalizeBoxSpacing(value: unknown): number {
    const spacing = typeof value === 'number' ? value : Number.parseFloat(String(value));
    return Number.isFinite(spacing) && spacing > 0 ? spacing : DEFAULT_BOX_SPACING;
}

/**
 * `GtkOrientable:orientation` from its nick. Anything but `vertical` is the pspec
 * default, `horizontal` — the same answer an unknown enum nick gets from GtkBuilder,
 * which rejects it and leaves the property untouched.
 */
export function normalizeBoxOrientation(value: unknown): BoxOrientation {
    return value === 'vertical' ? 'vertical' : 'horizontal';
}
