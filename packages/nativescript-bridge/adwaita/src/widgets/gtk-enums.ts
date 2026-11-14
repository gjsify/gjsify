// The plain GTK enums an application reads off `Gtk` on a target that has no GI — `Gtk.PolicyType`,
// `Gtk.ArrowType`, `Gtk.TextDirection`, `Gtk.TextExtendSelection`, `Gtk.License`, `Gtk.Align`,
// `Gtk.Orientation`, `Gtk.Justification`, `Gtk.SelectionMode` and `Gtk.WrapMode`, as value tables.
//
// The numbers are the typelib's: GIR declaration order, no aliases (unlike `Gtk.Align`, which
// `gtk-align.ts` has to derive). What each one DOES here:
//
//   · `PolicyType` is read by `Gtk.ScrolledWindow:hscrollbar-policy` / `vscrollbar-policy`
//     (`normalizePolicy` takes the constant), which folds it onto the `ScrollView` axis.
//   · `ArrowType` is what `Adw.SplitButton.get_direction()` answers and `set_direction()` takes.
//   · `TextDirection` is held, not acted on: a `get_direction()` here answers `LTR`, and no
//     widget mirrors under `RTL` — NativeScript's own `flowDirection` is not driven from it.
//   · `License` is `@gjsify/adwaita-core`'s `GTK_LICENSE`, the table `Adw.AboutDialog` reads.
//   · `Align`, `Orientation`, `Justification`, `SelectionMode` and `WrapMode` are what a GJS
//     snippet writes into `halign`, `orientation`, `justify`, `selection-mode` and `wrap-mode`;
//     every widget that has the property already takes the constant, so the table is the only
//     thing that was missing (the Android target-gap report counted 350+ uses of them).
//     Each table derives from the nick list its widget reads — position IS the constant — and
//     `scripts/check-nativescript-xml-doors.mjs` arm 8 holds the list against the typelib.
//
// Reference: refs/gtk gtk/gtkenums.h (GtkPolicyType, GtkTextDirection), gtk/gtkaboutdialog.h (GtkLicense)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { GTK_LICENSE, LABEL_JUSTIFICATIONS } from '@gjsify/adwaita-core';
import { constantName, tableOf } from './enum-table.js';
import { GTK_ALIGN } from './gtk-align.js';
import { GTK_POLICY_TYPES } from './scrolled-window-policy.js';
import { GTK_SELECTION_MODES } from './list-box-state.js';

/** `Gtk.Orientation`'s nicks, in the enum's order (HORIZONTAL=0, VERTICAL=1). */
export const GTK_ORIENTATIONS = ['horizontal', 'vertical'] as const;

/** `Gtk.WrapMode`'s nicks, in the enum's order (NONE=0 … WORD_CHAR=3). */
export const GTK_WRAP_MODES = ['none', 'char', 'word', 'word-char'] as const;

/** `Gtk.PolicyType`: `ALWAYS` 0, `AUTOMATIC` 1, `NEVER` 2, `EXTERNAL` 3. */
export const PolicyType = Object.freeze(
    Object.fromEntries(GTK_POLICY_TYPES.map((nick, value) => [nick.toUpperCase(), value])) as {
        readonly ALWAYS: 0;
        readonly AUTOMATIC: 1;
        readonly NEVER: 2;
        readonly EXTERNAL: 3;
    },
);

/** `Gtk.ArrowType`: `UP` 0, `DOWN` 1, `LEFT` 2, `RIGHT` 3, `NONE` 4 — `Adw.SplitButton:direction`. */
export const ArrowType = Object.freeze({
    UP: 0,
    DOWN: 1,
    LEFT: 2,
    RIGHT: 3,
    NONE: 4,
} as const);

/** `Gtk.TextDirection`: `NONE` 0, `LTR` 1, `RTL` 2. */
export const TextDirection = Object.freeze({
    NONE: 0,
    LTR: 1,
    RTL: 2,
} as const);

/** `Gtk.TextWindowType`: `WIDGET` 1, `TEXT` 2, `LEFT` 3, `RIGHT` 4, `TOP` 5, `BOTTOM` 6. */
export const TextWindowType = Object.freeze({
    WIDGET: 1,
    TEXT: 2,
    LEFT: 3,
    RIGHT: 4,
    TOP: 5,
    BOTTOM: 6,
} as const);

/** `Gtk.License`. */
export const License = GTK_LICENSE;

/** `Gtk.TextExtendSelection`: `WORD` 0 (a double click), `LINE` 1 (a triple click). */
export const TextExtendSelection = Object.freeze({ WORD: 0, LINE: 1 } as const);

/**
 * `Gtk.Align`: `FILL` 0, `START` 1, `END` 2, `CENTER` 3, `BASELINE_FILL` 4, `BASELINE` 4 (the
 * deprecated alias), `BASELINE_CENTER` 5 — the numbers `gtk-align.ts` derives from its one alias.
 */
export const Align = Object.freeze(
    Object.fromEntries(Object.entries(GTK_ALIGN).map(([nick, value]) => [constantName(nick), value])) as {
        readonly FILL: number;
        readonly START: number;
        readonly END: number;
        readonly CENTER: number;
        readonly BASELINE_FILL: number;
        readonly BASELINE: number;
        readonly BASELINE_CENTER: number;
    },
);

/** `Gtk.Orientation`: `HORIZONTAL` 0, `VERTICAL` 1. */
export const Orientation = tableOf(GTK_ORIENTATIONS);

/** `Gtk.Justification`: `LEFT` 0, `RIGHT` 1, `CENTER` 2, `FILL` 3. */
export const Justification = tableOf(LABEL_JUSTIFICATIONS);

/** `Gtk.SelectionMode`: `NONE` 0, `SINGLE` 1, `BROWSE` 2, `MULTIPLE` 3. */
export const SelectionMode = tableOf(GTK_SELECTION_MODES);

/** `Gtk.WrapMode`: `NONE` 0, `CHAR` 1, `WORD` 2, `WORD_CHAR` 3 — `Gtk.TextView:wrap-mode`. */
export const WrapMode = tableOf(GTK_WRAP_MODES);
