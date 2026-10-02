// SPDX-License-Identifier: MIT
//
// `Adw.HeaderBar` as the gallery shows it: the WHOLE widget tree lives in
// `header-bar.blp`, and this file is the class it is a template for.
//
// The class extends `Adw.Bin` rather than `Adw.HeaderBar` because AdwHeaderBar is
// a FINAL type — measured on libadwaita 1.9 / gjs 1.88.1, `registerClass` on a
// subclass of it fails with "Cannot inherit from a final type". Every Adwaita
// layout container the gallery documents is final; `Adw.Bin` is the derivable
// wrapper libadwaita provides for exactly this.

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';

import Template, { type Children, GTypeName, InternalChildren } from './header-bar.blp';

// ADR 0088: the class name, the id list and the type of every internal child come from the
// `.blp` that declares them. Renaming `menuButton` in the template now fails THIS file's
// type-check; before, the three hand-written copies stayed valid and `_menuButton` was
// silently `undefined` at run time.
//
// `extends Children` on a merged interface and not fields in the class body: `registerClass`
// installs the members, so a class field would be initialised to `undefined` at construction
// and shadow the installed property. That is also the answer to the rule below — its rationale
// is that TypeScript does not check whether a merged property is initialised, and here nothing
// in TypeScript may initialise it.
// oxlint-disable-next-line no-unsafe-declaration-merging -- intentional: GJS installs the internal children, so a class field would shadow them
export interface GalleryHeaderBar extends Children {}

export class GalleryHeaderBar extends Adw.Bin {
    static {
        GObject.registerClass({ GTypeName, Template, InternalChildren }, this);
    }

    constructor() {
        super();

        // The one thing a `.blp` cannot declare: a `Gio.Menu` is a model, not a
        // widget, so it is built here and handed to the button the template made.
        const menu = new Gio.Menu();
        menu.append('New Window', 'app.new-window');
        menu.append('Preferences', 'app.preferences');
        menu.append('About', 'app.about');
        this._menuButton.set_menu_model(menu);
    }
}
