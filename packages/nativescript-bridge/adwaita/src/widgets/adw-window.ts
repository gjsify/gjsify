// AdwWindow — a top-level window with one `content`, for NativeScript.
//
// There is no second window on this platform (`window-state.ts`), so this is the full-size
// container a `template $Foo : Adw.Window` builds into; `AdwWindowBase` has everything it
// does. It is its own class and not an alias of `AdwApplicationWindow` because they are two
// GTypes, and a template names one of them.
//
// Reference: refs/libadwaita/src/adw-window.c (AdwWindow)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { AdwWindowBase } from './window-base.js';

export class AdwWindow extends AdwWindowBase {
    constructor(props?: ConstructProps<AdwWindow>) {
        super();
        applyConstructProps(this, props);
    }
}
