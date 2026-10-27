// AdwApplicationWindow — the application's main window with one `content`, for NativeScript.
//
// The same root as `AdwWindow` (`AdwWindowBase`): the platform has one screen, so the
// application's window is the container a shared tree builds into. `application` is every
// window's (`GtkWindow`); the `win.` actions are the core's (ADR 0098); `show-menubar` has no counterpart.
//
// Reference: refs/libadwaita/src/adw-application-window.c (AdwApplicationWindow)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { type ActionLike, installActionMap } from '@gjsify/adwaita-core';

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwWindowBase } from './window-base.js';

export class AdwApplicationWindow extends AdwWindowBase {
    /** `Gio.ActionMap.add_action`: installed by `installActionMap`; reachable as `win.<name>`. */
    declare add_action: (action: ActionLike) => void;
    /** `Gio.ActionMap.lookup_action`: the window's own action, or `null`. */
    declare lookup_action: (action_name: string) => ActionLike | null;
    /** `Gio.ActionMap.remove_action`: an unknown name does nothing. */
    declare remove_action: (action_name: string) => void;

    static readonly GTypeName: string = 'AdwApplicationWindow';

    constructor(props?: ConstructProps<AdwApplicationWindow>) {
        super();
        applyConstructProps(this, props);
    }
}

installActionMap(AdwApplicationWindow.prototype);
