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
import Gtk from 'gi://Gtk?version=4.0';

import Template from './header-bar.blp';

export class GalleryHeaderBar extends Adw.Bin {
    declare private _menuButton: Gtk.MenuButton;

    static {
        GObject.registerClass({ GTypeName: 'GalleryHeaderBar', Template, InternalChildren: ['menuButton'] }, this);
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
