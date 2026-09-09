// Which of `Gtk.Button`'s three content slots is filled — the pure half.
//
// `GtkButton` has ONE child and three ways to put something in it: `set_label` builds a
// label, `set_icon_name` builds an image, `set_child` takes any widget. They are mutually
// exclusive and the LAST write wins — `gtk_button_set_label` calls `gtk_button_set_child`
// with a fresh `GtkLabel` and drops whatever was there, and so does `set_icon_name` with a
// fresh `GtkImage`. Nothing is merged, and there is no order of precedence among the
// properties: the sequence of writes is the whole answer.
//
// WHY IT IS WORTH A FUNCTION. On NativeScript the button is a `GridLayout` with one cell,
// so "the last write wins" has to be enforced by detaching the previous slot's view. Get
// that wrong and BOTH views stay parented in the same cell, painting on top of each
// other — at exit 0, which is precisely the silent failure
// `generate-adwaita-nativescript-templates.mjs` records for
// `LayoutBase._addChildFromBuilder`. The rule is therefore stated once, here, where the
// spec suite can drive it: the widget module cannot be imported off-device.
//
// Reference: refs/gtk gtk/gtkbutton.c (gtk_button_set_child, set_label, set_icon_name)
// Copyright (c) The GTK Team. LGPLv2.1+.

/** The slot a `Gtk.Button` currently shows. `empty` is a button with no child at all. */
export type ButtonSlot = 'label' | 'icon' | 'child' | 'empty';

/** Which property was written. */
export type ButtonSlotWrite = 'label' | 'icon' | 'child';

/**
 * The slot a button shows after `wrote` was assigned `value`.
 *
 * AN EMPTY LABEL IS STILL THE LABEL SLOT, and an empty icon name is still the icon slot:
 * `gtk_button_set_label("")` leaves a `GtkLabel` in the child, showing nothing — the
 * button is not childless, it has an empty label. Only `set_child(NULL)` empties it, which
 * is the one write that can return `empty`. Reading `''` as "clear the button" would make
 * a caller who blanks a label lose the padding the child was holding.
 */
export function buttonSlotAfterWrite(wrote: ButtonSlotWrite, value: unknown): ButtonSlot {
    if (wrote !== 'child') return wrote;
    return value === null || value === undefined ? 'empty' : 'child';
}

/** Whether moving from `from` to `to` has to detach the view `from` had parented. */
export function buttonSlotDetaches(from: ButtonSlot, to: ButtonSlot): boolean {
    return from !== to && from !== 'empty';
}
