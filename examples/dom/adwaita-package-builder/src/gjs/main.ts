// Adwaita Package Builder Showcase — GJS entry point.
//
// Demonstrates the three packaging steps of a GNOME/GJS app built entirely
// through `@gjsify/cli`:
//
//   1. `gjsify gresource` compiles `data/*.gresource.xml` into a binary bundle
//      loaded here via `Gio.Resource.load` + `Gio.resources_register`.
//   2. `gjsify gettext --format mo` produces a per-language locale tree loaded
//      here via `bindtextdomain(domain, dist/locale)`.
//   3. `gjsify build --shebang` post-processes the outfile so this script runs
//      as `./dist/com.gjsify.ShowcasePackageBuilder` without a wrapper.

import '@girs/gjs';
import '@girs/gtk-4.0';

import Adw from 'gi://Adw?version=1';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import System from 'system';
import Gettext from 'gettext';

import { MainWindow } from './main-window.js';

const APP_ID = 'com.gjsify.ShowcasePackageBuilder';

// Resolve runtime asset paths relative to the executable. Works both for
// `gjsify run dist/<bin>` (programInvocationName points at the bin) and for
// the shebanged binary invoked directly as `./dist/<bin>`.
const binDir = GLib.path_get_dirname(System.programInvocationName);

// Load + register the GResource bundle produced by `yarn build:resources`.
const resPath = GLib.build_filenamev([binDir, `${APP_ID}.data.gresource`]);
const resource = Gio.Resource.load(resPath);
Gio.resources_register(resource);

// Point gettext at the locale tree produced by `yarn build:i18n`.
const localeDir = GLib.build_filenamev([binDir, 'locale']);
Gettext.bindtextdomain(APP_ID, localeDir);
Gettext.textdomain(APP_ID);

const app = new Adw.Application({
    application_id: APP_ID,
    flags: Gio.ApplicationFlags.FLAGS_NONE,
});

app.connect('activate', () => {
    let win = app.get_active_window();
    if (!win) {
        win = new MainWindow(app);
    }
    win.present();
});

app.run([]);
