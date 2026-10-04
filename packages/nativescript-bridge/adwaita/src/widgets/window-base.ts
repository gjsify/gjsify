// The shared half of `Adw.Window` and `Adw.ApplicationWindow` for NativeScript — the ROOT a
// shared tree builds into.
//
// WHAT A WINDOW IS ON THIS PLATFORM (`window-state.ts` has the long form): a full-size
// `GridLayout` with ONE star cell. The `content` fills it, and a dialog presented over a
// widget inside it goes into the same cell ABOVE the content (`_hostDialog`), which is how
// this platform stacks views — the same arrangement `Gtk.Overlay` uses, and the reason the
// content is inserted at index 0 by `AdwSingleChildBase`. Toasts need nothing here: an
// `Adw.ToastOverlay` is a widget of its own and a window's content is where it goes, as in
// libadwaita.
//
// `content` IS `child`. `Adw.Window` has a `GtkWindow:child` that libadwaita disables in
// favour of `content`; here both names reach the one cell, because the base's child door is
// the only one there is and a second slot would be a second cell nothing could address.
//
// Named `Adw…` like `AdwSingleChildBase`, its base, so the gates that read widget classes by
// prefix see it; abstract, and constructed only through `AdwWindow` /
// `AdwApplicationWindow`, which take their own construct bag.
//
// Reference: refs/libadwaita/src/adw-window.c (AdwWindow)
// Reference: refs/libadwaita/src/adw-application-window.c (AdwApplicationWindow)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { GridLayout, type View } from '@nativescript/core';

import { builderSlotsOf } from './builder-slots.js';
import { AdwSingleChildBase } from './single-child-base.js';
import { type DialogHost, surfaceSize } from './window-state.js';
import { xmlNumber } from './xml-values.js';

/**
 * The class a window wears — the one the theme already gives a `Page`
 * (`.adw-window`, Adwaita's `.background`: window fill and text colour), so a window built
 * into a bare layout looks like the page it would have been.
 */
export const ADW_WINDOW_CLASS = 'adw-window';

export abstract class AdwWindowBase extends AdwSingleChildBase implements DialogHost {
    /** `content` is the one destination, so it is also the fallback. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['content'], 'content');

    private _title = '';
    private _defaultWidth = 0;
    private _defaultHeight = 0;
    private readonly _dialogs: View[] = [];

    constructor() {
        super();
        this._restyle();
    }

    protected override get _ownClass(): string {
        return ADW_WINDOW_CLASS;
    }

    // --- content ---

    /** `Adw.Window:content` / `Adw.ApplicationWindow:content`. */
    get content(): View | null {
        return this.child;
    }

    set content(view: View | null) {
        this.child = view;
    }

    /** `adw_window_set_content`. */
    set_content(view: View | null): void {
        this.child = view;
    }

    /** `adw_window_get_content`. */
    get_content(): View | null {
        return this.child;
    }

    // --- properties ---

    /** `GtkWindow:title`. Held: a `Page` has no title bar of this window's to put it in. */
    get title(): string {
        return this._title;
    }

    set title(value: string | null) {
        this._title = value ?? '';
    }

    /** `GtkWindow:default-width` — held and read back; the screen is the width. */
    get defaultWidth(): number {
        return this._defaultWidth;
    }

    set defaultWidth(value: number | string) {
        this._defaultWidth = surfaceSize(xmlNumber(value, Number.NaN), value, this._defaultWidth, 'defaultWidth');
    }

    /** `GtkWindow:default-height` — held and read back; the screen is the height. */
    get defaultHeight(): number {
        return this._defaultHeight;
    }

    set defaultHeight(value: number | string) {
        this._defaultHeight = surfaceSize(xmlNumber(value, Number.NaN), value, this._defaultHeight, 'defaultHeight');
    }

    // --- dialogs ---

    /** The dialogs presented over this window and not yet closed, bottom to top. */
    get dialogs(): readonly View[] {
        return [...this._dialogs];
    }

    /** `DialogHost` — `AdwDialog.present (parent)` calls this on the window it finds. */
    _hostDialog(dialog: unknown): void {
        const view = dialog as View;
        if (this._dialogs.includes(view)) return;
        GridLayout.setColumn(view, 0);
        GridLayout.setRow(view, 0);
        this.addChild(view);
        this._dialogs.push(view);
    }

    /** `DialogHost` — the dialog closed. A view this window did not host is left alone. */
    _unhostDialog(dialog: unknown): void {
        const view = dialog as View;
        const at = this._dialogs.indexOf(view);
        if (at === -1) return;
        this._dialogs.splice(at, 1);
        this.removeChild(view);
    }
}
