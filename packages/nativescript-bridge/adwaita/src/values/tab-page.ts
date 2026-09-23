// `Adw.TabPage` — one page of an `Adw.TabView`, as the value object GTK makes it.
//
// NOT A VIEW: `AdwTabPage` is a GObject the tab view creates around a child widget, and a
// `.blp` writes `Adw.TabPage { title: "…"; child: Gtk.Label { }; }` inside the view
// (adw-tab-view.c:2886). The view reads it into a page of its model; the page's `child` is
// the content it shows. Under `values/`, as `./sidebar.ts` explains: a constructible value
// (`CONSTRUCTIBLE_VALUES`), not a widget.
//
// THE FIELDS ARE THE ONES THIS PORT'S TAB VIEW DRAWS FROM A PAGE — the title. GTK's page
// also carries `tooltip`, `icon`, `loading`, `needs-attention`, `indicator-*`, `keyword`
// and the thumbnail properties; declared here while nothing drew them, the shared-tree
// builder would accept an authored value and show nothing for it, so they stay
// undeclared and the builder refuses each by name.
//
// Reference: refs/libadwaita/src/adw-tab-view.c (AdwTabPage properties, :564-820)
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import type { View } from '@nativescript/core';

import { builderSlotsOf } from '../widgets/builder-slots.js';

/** What `new Adw.TabPage({ … })` takes. */
export interface AdwTabPageProps {
    title?: string | null;
}

export class AdwTabPage {
    /** `Adw.TabPage:child` is the one destination, so it is the fallback too. */
    static readonly builderSlots: readonly string[] = builderSlotsOf(['child'], 'child');

    /** `Adw.TabPage:title` — the tab's label. */
    title: string;
    /** `Adw.TabPage:child` — the content the page shows, or `null` before one is set. */
    child: View | null = null;

    constructor(props?: AdwTabPageProps | null) {
        this.title = props?.title ?? '';
    }

    /** XML inflation: `child: …` (or a bare child) is the page's content. */
    _addChildFromBuilder(_name: string, view: View): void {
        this.child = view;
    }
}
