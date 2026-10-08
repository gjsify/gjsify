// The plain GTK enums an application reads off `Gtk` on a target that has no GI — `Gtk.PolicyType`,
// `Gtk.TextDirection` and `Gtk.License`, as value tables.
//
// The numbers are the typelib's: GIR declaration order, no aliases (unlike `Gtk.Align`, which
// `gtk-align.ts` has to derive). What each one DOES here:
//
//   · `PolicyType` is read by `Gtk.ScrolledWindow:hscrollbar-policy` / `vscrollbar-policy`
//     (`normalizePolicy` takes the constant), which folds it onto the `ScrollView` axis.
//   · `TextDirection` is held, not acted on: a `get_direction()` here answers `LTR`, and no
//     widget mirrors under `RTL` — NativeScript's own `flowDirection` is not driven from it.
//   · `License` is `@gjsify/adwaita-core`'s `GTK_LICENSE`, the table `Adw.AboutDialog` reads.
//
// Reference: refs/gtk gtk/gtkenums.h (GtkPolicyType, GtkTextDirection), gtk/gtkaboutdialog.h (GtkLicense)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GTK_LICENSE } from '@gjsify/adwaita-core';
import { GTK_POLICY_TYPES } from './scrolled-window-policy.js';

/** `Gtk.PolicyType`: `ALWAYS` 0, `AUTOMATIC` 1, `NEVER` 2, `EXTERNAL` 3. */
export const PolicyType = Object.freeze(
    Object.fromEntries(GTK_POLICY_TYPES.map((nick, value) => [nick.toUpperCase(), value])) as {
        readonly ALWAYS: 0;
        readonly AUTOMATIC: 1;
        readonly NEVER: 2;
        readonly EXTERNAL: 3;
    },
);

/** `Gtk.TextDirection`: `NONE` 0, `LTR` 1, `RTL` 2. */
export const TextDirection = Object.freeze({ NONE: 0, LTR: 1, RTL: 2 } as const);

/** `Gtk.License`. */
export const License = GTK_LICENSE;
