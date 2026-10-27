// GtkApplicationWindow — a `Gtk.Window` that is a `Gio.ActionMap`, for NativeScript.
//
// The subclass brings the `win.` action group: `add_action`, `lookup_action` and `remove_action`
// are the core's (`installActionMap`, ADR 0098), the same ones `<gtk-application-window>` and
// `Adw.ApplicationWindow` carry. An action added here resolves as `win.<name>` from every
// `Gtk.Actionable` below the window, and accelerators set through
// `Gtk.Application.set_accels_for_action('win.x', …)` reach it without the application
// inserting a `Gio.SimpleActionGroup` by hand. `show-menubar` has no counterpart here.
//
// Reference: refs/gtk/gtk/gtkapplicationwindow.c (GtkApplicationWindow)
// Copyright (c) The GTK Team. LGPLv2.1+.

import { type ActionLike, installActionMap } from '@gjsify/adwaita-core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { GtkWindow } from './gtk-window.js';

export class GtkApplicationWindow extends GtkWindow {
    /** `Gio.ActionMap.add_action`: installed by `installActionMap`; reachable as `win.<name>`. */
    declare add_action: (action: ActionLike) => void;
    /** `Gio.ActionMap.lookup_action`: the window's own action, or `null`. */
    declare lookup_action: (action_name: string) => ActionLike | null;
    /** `Gio.ActionMap.remove_action`: an unknown name does nothing. */
    declare remove_action: (action_name: string) => void;

    static override readonly GTypeName: string = 'GtkApplicationWindow';

    constructor(props?: ConstructProps<GtkApplicationWindow>) {
        super();
        applyConstructProps(this, props);
    }
}

installActionMap(GtkApplicationWindow.prototype);
