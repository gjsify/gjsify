// AdwBin — a widget with one child, for NativeScript.
//
// `Adw.Bin` draws nothing and lays nothing out: it is the container a Blueprint
// `template $Foo : Adw.Bin { … }` extends so a composite widget has exactly one child to
// hold. Learn6502's own widgets are all this shape (`ThemeModeSelector`, `MainButton`,
// `Display`, …), and until it existed here none of those templates could be built.
//
// A REAL NativeScript `GridLayout` with one star cell, which is what `AdwSingleChildBase`
// is; the child's own `halign` / `valign` place it in that cell. The child door is
// `adw_bin_set_child`, and both `child: …` and a bare XML child reach it (adw-bin.c's
// `add_child` makes every child THE child).
//
// Reference: refs/libadwaita/src/adw-bin.c (AdwBin)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { applyConstructProps, type ConstructProps } from './construct-props.js';
import { builderSlotsOf } from './builder-slots.js';
import { AdwSingleChildBase } from './single-child-base.js';

export class AdwBin extends AdwSingleChildBase {
    /** `Adw.Bin:child` is the one destination, so it is also the fallback. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    constructor(props?: ConstructProps<AdwBin>) {
        super();
        applyConstructProps(this, props);
    }
}
