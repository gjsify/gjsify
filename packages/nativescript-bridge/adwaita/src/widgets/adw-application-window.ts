// AdwApplicationWindow — the application's main window with one `content`, for NativeScript.
//
// The same root as `AdwWindow` (`AdwWindowBase`): the platform has one screen, so the
// application's window is the container a shared tree builds into. `application` and the
// `win.` actions are the core's (ADR 0098); `show-menubar` has no counterpart.
//
// Reference: refs/libadwaita/src/adw-application-window.c (AdwApplicationWindow)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { defineWindowApplication } from './application.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwWindowBase } from './window-base.js';

export class AdwApplicationWindow extends AdwWindowBase {
    /** `Gtk.Window:application`: setting it is `add_window` (ADR 0098), set by `defineWindowApplication`. */
    declare application: object | null;

    constructor(props?: ConstructProps<AdwApplicationWindow>) {
        super();
        applyConstructProps(this, props);
    }
}

defineWindowApplication(AdwApplicationWindow.prototype);
