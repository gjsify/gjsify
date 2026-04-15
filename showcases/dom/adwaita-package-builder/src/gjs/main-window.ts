// Adwaita window for the Package Builder showcase.
//
// - Blueprint template → compiled by `@gjsify/esbuild-plugin-blueprint`.
// - CSS → loaded from the GResource bundle (see build:resources).
// - Translated strings → looked up via Gettext against dist/locale (build:i18n).

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gettext from 'gettext';

import Template from './main-window.blp';

const _ = Gettext.gettext;

export class MainWindow extends Adw.ApplicationWindow {
    declare private _greeting: Gtk.Label;
    declare private _detail: Gtk.Label;

    static {
        GObject.registerClass({
            GTypeName: 'MainWindow',
            Template,
            InternalChildren: ['greeting', 'detail'],
        }, this);
    }

    constructor(application: Adw.Application) {
        super({ application });

        // CSS lives inside the embedded GResource under the app's resource path.
        const provider = new Gtk.CssProvider();
        provider.load_from_resource('/com/gjsify/ShowcasePackageBuilder/style.css');
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default()!,
            provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
        );

        // Translated strings — the msgid values must also appear in po/*.po.
        this._greeting.set_label(_('Hello from gjsify'));
        this._detail.set_label(_('CSS from GResource · Text from Gettext · Binary from --shebang'));
    }
}
