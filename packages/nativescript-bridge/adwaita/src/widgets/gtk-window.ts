// GtkWindow — the top-level window, for NativeScript.
//
// There is one screen on this platform (`window-state.ts`), so a window is the full-size
// container a shared tree builds into, and `Adw.Window` / `Adw.ApplicationWindow` descend from
// it as they do in libadwaita. That chain is the point: `widget.get_root() instanceof
// Gtk.Window` holds for the application root, which is how an application finds the window to
// hand `Gtk.show_uri`.
//
// A TRUE SUBSET: `title`, `default-width` and `default-height` are held and read back; every
// other `GtkWindow` member is absent, not stubbed.
//
// Reference: refs/gtk/gtk/gtkwindow.c (GtkWindow)
// Copyright (c) GNOME contributors (GTK). LGPLv2.1+.

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwSingleChildBase } from './single-child-base.js';
import { surfaceSize } from './window-state.js';
import { xmlNumber } from './xml-values.js';

export class GtkWindow extends AdwSingleChildBase {
    static readonly GTypeName: string = 'GtkWindow';

    private _title = '';
    private _defaultWidth = 0;
    private _defaultHeight = 0;

    constructor(props?: ConstructProps<GtkWindow>) {
        super();
        applyConstructProps(this, props);
    }

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
}
