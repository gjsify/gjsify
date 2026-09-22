// `Gtk.Box` property vectors — how an authored value becomes the property a box lays out
// with. Driven by `box.spec.ts` against the core functions and by adwaita-web's
// `gtk-box.spec.ts` against the element's attributes; the NativeScript box reads the same
// functions through `box-layout.ts`.
//
// Reference: refs/gtk/gtk/gtkbox.c (the `spacing` pspec: an int, minimum 0, default 0)
// Reference: refs/gtk/gtk/gtkorientable.c (`orientation`, default horizontal)
// Copyright (c) The GTK Team. LGPLv2.1+.

/** One authored `spacing` and the gap the box lays out with. */
export interface BoxSpacingVector {
    /** As authored: a number from code, a string from an attribute, `null` when absent. */
    value: number | string | null;
    spacing: number;
    rule: string;
}

/**
 * `Gtk.Box:spacing`. The negative rows are the ones a port gets wrong quietly — measured
 * under gjs 1.88.1 / gtk 4.22.4, a negative write reads back as 0, so a box never pulls
 * its children together.
 */
export const BOX_SPACING_VECTORS: ReadonlyArray<BoxSpacingVector> = [
    { value: null, spacing: 0, rule: 'an absent spacing is the default, 0' },
    { value: 12, spacing: 12, rule: 'a plain positive value passes through' },
    { value: '12', spacing: 12, rule: 'the string an attribute carries parses' },
    { value: -4, spacing: 0, rule: 'a negative value lands on the property minimum, 0' },
    { value: '-4', spacing: 0, rule: 'a negative string is held at 0 too' },
    { value: 'wide', spacing: 0, rule: 'an unparseable value is the default — NaN never reaches a layout' },
];

/** One authored `orientation` and the axis the box stacks along. */
export interface BoxOrientationVector {
    value: string | null;
    orientation: 'horizontal' | 'vertical';
    rule: string;
}

/** `GtkOrientable:orientation`, read by nick as GtkBuilder reads an enum. */
export const BOX_ORIENTATION_VECTORS: ReadonlyArray<BoxOrientationVector> = [
    { value: null, orientation: 'horizontal', rule: 'an absent orientation is the default, horizontal' },
    { value: 'vertical', orientation: 'vertical', rule: 'the vertical nick stacks a column' },
    { value: 'horizontal', orientation: 'horizontal', rule: 'the horizontal nick is a row' },
    { value: 'VERTICAL', orientation: 'horizontal', rule: 'a string that is no nick leaves the default' },
];
