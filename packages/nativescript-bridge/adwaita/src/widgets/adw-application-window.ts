// AdwApplicationWindow — the application's main window with one `content`, for NativeScript.
//
// The same root as `AdwWindow` (`AdwWindowBase`): the platform has one screen, so the
// application's window is the container a shared tree builds into. `Gio.Application`
// integration (`application`, `show-menubar`, the window actions) has no counterpart.
//
// Reference: refs/libadwaita/src/adw-application-window.c (AdwApplicationWindow)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwWindowBase } from './window-base.js';

export class AdwApplicationWindow extends AdwWindowBase {
    constructor(props?: ConstructProps<AdwApplicationWindow>) {
        super();
        applyConstructProps(this, props);
    }
}
