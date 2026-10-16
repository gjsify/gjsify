// AdwApplicationWindow — the application's main window with one `content`, for NativeScript.
//
// The same root as `AdwWindow` (`AdwWindowBase`): the platform has one screen, so the
// application's window is the container a shared tree builds into. `application` is every
// window's (`GtkWindow`); the `win.` actions are the core's (ADR 0098); `show-menubar` has no counterpart.
//
// Reference: refs/libadwaita/src/adw-application-window.c (AdwApplicationWindow)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { installActionMap } from '@gjsify/adwaita-core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwWindowBase } from './window-base.js';

export class AdwApplicationWindow extends AdwWindowBase {
    static readonly GTypeName: string = 'AdwApplicationWindow';

    constructor(props?: ConstructProps<AdwApplicationWindow>) {
        super();
        applyConstructProps(this, props);
    }
}

installActionMap(AdwApplicationWindow.prototype);
