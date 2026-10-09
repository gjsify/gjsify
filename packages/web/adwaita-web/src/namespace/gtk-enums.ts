// The plain GTK enums an application reads off `Gtk` — `Gtk.PolicyType`, `Gtk.TextDirection` and
// `Gtk.TextWindowType`, as value tables. The numbers are the typelib's (GIR declaration order),
// and the same tables the NativeScript port publishes.
//
// Reference: refs/gtk gtk/gtkenums.h (GtkPolicyType, GtkTextDirection), gtk/gtktextview.h (GtkTextWindowType)
// Copyright (c) The GTK Team. LGPLv2.1+.

/** `Gtk.PolicyType`: `ALWAYS` 0, `AUTOMATIC` 1, `NEVER` 2, `EXTERNAL` 3. */
export const PolicyType = Object.freeze({ ALWAYS: 0, AUTOMATIC: 1, NEVER: 2, EXTERNAL: 3 } as const);

/** `Gtk.TextDirection`: `NONE` 0, `LTR` 1, `RTL` 2. */
export const TextDirection = Object.freeze({ NONE: 0, LTR: 1, RTL: 2 } as const);

/** `Gtk.TextWindowType`: `WIDGET` 1, `TEXT` 2, `LEFT` 3, `RIGHT` 4, `TOP` 5, `BOTTOM` 6. */
export const TextWindowType = Object.freeze({ WIDGET: 1, TEXT: 2, LEFT: 3, RIGHT: 4, TOP: 5, BOTTOM: 6 } as const);
