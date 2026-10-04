// The pure half of `Adw.Window`, `Adw.ApplicationWindow` and `Adw.Dialog` for NativeScript —
// what a size property means, which presentation modes exist, and how a dialog finds the
// window that shows it. No `@nativescript/core` import, so specs reach it off-device.
//
// A WINDOW IS NOT A WINDOW HERE. NativeScript has one `Page` per screen and no top-level
// surface a program can open, size or title, so `Adw.Window` is a full-size container a
// shared tree builds INTO — the root a `template $Foo : Adw.ApplicationWindow` extends — and
// `default-width` / `default-height` are values it holds and reads back, never a size it
// imposes: the screen is the size. A dialog likewise cannot open a second window; it is an
// overlay the root hosts (`AdwAboutDialog` and `AdwPreferencesDialog` are the same shape), and
// `present(parent)` is the door that finds that root from any widget inside it.
//
// Reference: refs/libadwaita/src/adw-dialog.c (adw_dialog_present, adw_dialog_close)
// Reference: refs/libadwaita/src/adw-window.c (AdwWindow:content)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { transitionNick } from './transition-type.js';

/**
 * `Adw.DialogPresentationMode`, in declaration order — a position IS the GIR constant,
 * held against `generated/enum-values.mts` by arm 8 of `check-nativescript-xml-doors.mjs`.
 */
export const ADW_DIALOG_PRESENTATION_MODES = ['auto', 'floating', 'bottom-sheet'] as const;

export type AdwDialogPresentationNick = (typeof ADW_DIALOG_PRESENTATION_MODES)[number];

/** `AdwDialog:presentation-mode` default. */
export const DEFAULT_DIALOG_PRESENTATION_MODE: AdwDialogPresentationNick = 'auto';

/** The presentation mode a write means, or throw naming the members. */
export function dialogPresentationMode(value: unknown): AdwDialogPresentationNick {
    return transitionNick(value, ADW_DIALOG_PRESENTATION_MODES, 'Adw.DialogPresentationMode');
}

/**
 * A window's or dialog's size property — `default-width`, `default-height`, `content-width`,
 * `content-height` — an integer from `-1` up.
 *
 * GTK's pspecs are `-1 … G_MAXINT` and both `-1` and the default `0` mean "no size asked":
 * the surface takes its natural one. The setter parses with `xmlNumber` (an attribute is
 * always a string) and hands the result here with what was written: a value that is not such
 * an integer is refused rather than clamped, as the other integer properties of this port are,
 * and a blank attribute keeps what was there.
 */
export function surfaceSize(parsed: number, written: unknown, current: number, property: string): number {
    if (typeof written === 'string' && written.trim() === '') return current;
    if (Number.isInteger(parsed) && parsed >= -1) return parsed;
    throw new TypeError(`'${String(written)}' is not a size: '${property}' takes an integer from -1 upward.`);
}

/** What a dialog hands itself to when it is presented over a widget. */
export interface DialogHost {
    /** Put `dialog` above everything the host shows. */
    _hostDialog(dialog: unknown): void;
    /** Take it back out once it closed. */
    _unhostDialog(dialog: unknown): void;
}

/** A node with a parent — the one thing the host walk reads off a view. */
interface HasParent {
    readonly parent?: HasParent | null;
}

function isDialogHost(candidate: unknown): candidate is DialogHost {
    const host = candidate as Partial<DialogHost> | null | undefined;
    return typeof host?._hostDialog === 'function' && typeof host._unhostDialog === 'function';
}

/**
 * The window `adw_dialog_present (dialog, parent)` shows a dialog in: `parent` itself, or the
 * nearest ancestor of it, that hosts dialogs — or `null`.
 *
 * `adw_dialog_present` walks to the parent's `GtkRoot`; this port's equivalent of a root is a
 * view that implements the two host methods, so the walk stops at the first one rather than
 * at a class.
 */
export function findDialogHost(start: unknown): DialogHost | null {
    let view = start as HasParent | null | undefined;
    // A bound the walk can never exceed: a cycle in `parent` is a platform fault, and an
    // unbounded loop would turn it into a hang.
    for (let depth = 0; view !== null && view !== undefined && depth < 4096; depth++) {
        if (isDialogHost(view)) return view;
        view = view.parent;
    }
    return null;
}
