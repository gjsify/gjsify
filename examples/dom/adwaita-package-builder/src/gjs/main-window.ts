// Adwaita window for the Package Builder showcase.
//
// - Blueprint template → compiled by `@gjsify/esbuild-plugin-blueprint`.
// - Two CSS loading paths, demonstrating both packaging options:
//     (1) GResource bundle (data/style.css) → loaded via `load_from_resource`.
//     (2) JS-bundled string (runtime-style.css) → imported here as a string
//         by `@gjsify/esbuild-plugin-css`, which also resolves `@import`
//         statements at build time, and loaded via `load_from_string`.
// - Translated strings → looked up via Gettext against dist/locale (build:i18n).

import GObject from 'gi://GObject?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import Adw from 'gi://Adw?version=1';
import Gdk from 'gi://Gdk?version=4.0';
import Gettext from 'gettext';

import Template from './main-window.blp';
// Bundled by `@gjsify/esbuild-plugin-css`. The plugin runs an inner esbuild
// pass with `loader: { '.css': 'css' }`, follows the `@import "./overrides.css"`
// declaration, and inlines the concatenated CSS as this default export.
import runtimeStyle from './runtime-style.css';

const _ = Gettext.gettext;

export class MainWindow extends Adw.ApplicationWindow {
    declare private _greeting: Gtk.Label;
    declare private _detail: Gtk.Label;
    declare private _runtimeNote: Gtk.Label;

    static {
        GObject.registerClass({
            GTypeName: 'MainWindow',
            Template,
            InternalChildren: ['greeting', 'detail', 'runtimeNote'],
        }, this);
    }

    constructor(application: Adw.Application) {
        super({ application });

        const display = Gdk.Display.get_default()!;

        // Path (1): CSS from the embedded GResource bundle.
        const resourceProvider = new Gtk.CssProvider();
        resourceProvider.load_from_resource('/com/gjsify/ShowcasePackageBuilder/style.css');
        Gtk.StyleContext.add_provider_for_display(
            display,
            resourceProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
        );

        // Path (2): CSS bundled into the JS binary at build time.
        // `runtimeStyle` is a single string containing runtime-style.css plus
        // everything it `@import`s (overrides.css) — resolved by
        // `@gjsify/esbuild-plugin-css`.
        const runtimeProvider = new Gtk.CssProvider();
        runtimeProvider.load_from_string(runtimeStyle);
        Gtk.StyleContext.add_provider_for_display(
            display,
            runtimeProvider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION,
        );

        // Translated strings — the msgid values must also appear in po/*.po.
        this._greeting.set_label(_('Hello from gjsify'));
        this._detail.set_label(_('CSS from GResource · Text from Gettext · Binary from --shebang'));
        this._runtimeNote.set_label(_('CSS bundled into the JS binary via @gjsify/esbuild-plugin-css'));
    }
}
