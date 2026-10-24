// @gjsify/adwaita-app — addAppIconDir tests. GJS + a GTK runtime, no display.
//
// The subject is what `Gtk.IconTheme` resolves, so the fixture is a real `hicolor` tree on
// disk and the assertion is `has_icon`, not "add_search_path was called". `Gtk.IconTheme.new()`
// takes the same lookup path as the display's theme and needs no display (see icon-theme.spec.ts).

import { describe, expect, it } from '@gjsify/unit';

import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { addAppIconDir } from './app-icon.js';

Gtk.init_check();

const APP_ID = 'org.example.IconFixture';
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16"><rect width="16" height="16"/></svg>';

/** A `<root>/data/icons/hicolor/scalable/apps/<APP_ID>.svg` tree; returns `<root>`. */
function fixtureRoot(): string {
    const root = GLib.dir_make_tmp('gjsify-app-icon-XXXXXX');
    const apps = GLib.build_filenamev([root, 'data', 'icons', 'hicolor', 'scalable', 'apps']);
    GLib.mkdir_with_parents(apps, 0o755);
    Gio.File.new_for_path(GLib.build_filenamev([apps, `${APP_ID}.svg`])).replace_contents(
        new TextEncoder().encode(SVG),
        null,
        false,
        Gio.FileCreateFlags.NONE,
        null,
    );
    return root;
}

function bareTheme(): Gtk.IconTheme {
    const theme = Gtk.IconTheme.new();
    theme.set_search_path(['/usr/share/icons']);
    return theme;
}

export default async () => {
    await describe('addAppIconDir', async () => {
        await it('makes the app icon resolvable from an explicit iconDir', () => {
            const root = fixtureRoot();
            const theme = bareTheme();
            expect(theme.has_icon(APP_ID)).toBe(false);
            expect(addAppIconDir(theme, APP_ID, { iconDir: `${root}/data/icons` })).toBe(true);
            expect(theme.has_icon(APP_ID)).toBe(true);
        });

        await it('finds data/icons by searching up from the bundle directory', () => {
            const root = fixtureRoot();
            const dist = GLib.build_filenamev([root, 'dist', 'app']);
            GLib.mkdir_with_parents(dist, 0o755);
            const theme = bareTheme();
            expect(addAppIconDir(theme, APP_ID, { startDir: dist })).toBe(true);
            expect(theme.has_icon(APP_ID)).toBe(true);
        });

        await it('adds nothing when the theme already has the icon', () => {
            const root = fixtureRoot();
            const theme = bareTheme();
            theme.add_search_path(`${root}/data/icons`);
            expect(theme.has_icon(APP_ID)).toBe(true);
            expect(addAppIconDir(theme, APP_ID, { iconDir: '/nonexistent/icons' })).toBe(false);
            expect(theme.get_search_path()?.includes('/nonexistent/icons') ?? false).toBe(false);
        });

        await it('adds nothing when no directory can be found', () => {
            const theme = bareTheme();
            expect(addAppIconDir(theme, APP_ID, { startDir: '/' })).toBe(false);
            expect(theme.has_icon(APP_ID)).toBe(false);
        });
    });
};
