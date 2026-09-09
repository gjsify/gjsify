// Which glyph is DRAWN — not whether a resource path was registered.
//
// THE ARM THAT WOULD OTHERWISE BE GREEN AND MEANINGLESS. `add_resource_path` returns
// nothing and never fails: a test that calls it and then asserts it was called proves the
// call happened, which was never in doubt. What is in doubt is which of two documents with
// the same name GTK hands the widget. So every assertion here goes through
// `Gtk.IconTheme.lookup_icon(...).get_file()` — the file the widget paints — and the
// central one goes one step further and compares the BYTES at that URI against the glyph
// the bundle was built from. A URI can be right for a file whose contents are not.
//
// It caught a real defect on its first run. The generator filed `emblem-system-symbolic`
// under `scalable/legacy/`, copying Adwaita's own layout — but a resource path is looked up
// as part of HICOLOR, whose `index.theme` defines no `legacy` directory, so GTK never
// scanned it and the name fell through to GTK's own builtin resource icons. The resource
// contained the glyph, the path was registered, and a different picture was drawn, with no
// error anywhere. Arm 1 below is the general form of that failure.
//
// NO DISPLAY REQUIRED, deliberately: `Gtk.IconTheme.new()` plus a search path is the same
// lookup machinery `get_for_display()` returns, and it takes a theme NAME, which a
// display's theme refuses. Measured with `env -i … GDK_BACKEND=x11`: `Gtk.init_check()` is
// false and every lookup below still resolves.

import { describe, expect, it } from '@gjsify/unit';

import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import {
    BUNDLED_ICON_COUNT,
    BUNDLED_ICON_RESOURCE_PATH,
    BUNDLED_ICON_THEME_NAME,
    addBundledIconsToTheme,
    installBundledIconTheme,
    registerBundledIconResource,
} from './icon-theme.js';

/** Where a system theme would live. Explicit, so the test does not depend on the env. */
const SYSTEM_SEARCH_PATH = ['/usr/share/icons', '/usr/share/pixmaps'];

/**
 * GTK has to be initialised before `Gtk.IconTheme` exists, and `init_check` is the form
 * that survives having no display.
 *
 * MEASURED, because the failure is not an exception: `Gtk.IconTheme.new()` in an
 * uninitialised process SEGFAULTS — exit 139, before the first `print` of the file, with
 * no GJS stack and nothing on stderr. Under the test runner that surfaced only as
 * `gjs exited with signal SIGTERM` part-way through the second suite. `init_check()`
 * returns FALSE here (no display) and every lookup below still resolves; `init()` would
 * abort instead, which is why it is not used.
 */
let gtkReady = false;
function initGtk(): void {
    if (gtkReady) return;
    Gtk.init_check();
    gtkReady = true;
}

/** A theme object standing in for a host running `themeName`. */
function hostTheme(themeName: string, withBundle: boolean): Gtk.IconTheme {
    initGtk();
    const theme = Gtk.IconTheme.new();
    theme.set_search_path(SYSTEM_SEARCH_PATH);
    theme.set_theme_name(themeName);
    if (withBundle) addBundledIconsToTheme(theme);
    return theme;
}

/** The URI of the file a lookup of `name` would paint, or `''`. */
function drawnUri(theme: Gtk.IconTheme, name: string): string {
    return theme.lookup_icon(name, null, 16, 1, Gtk.TextDirection.NONE, 0).get_file()?.get_uri() ?? '';
}

/** Every icon name the compiled bundle actually contains, read out of the resource. */
function bundledNames(): string[] {
    initGtk();
    registerBundledIconResource();
    const walk = (dir: string): string[] =>
        Gio.resources_enumerate_children(dir, 0).flatMap((child) =>
            child.endsWith('/') ? walk(dir + child) : [dir + child],
        );
    return walk(`${BUNDLED_ICON_RESOURCE_PATH}/`).map((path) =>
        (path.split('/').pop() as string).replace(/\.svg$/, ''),
    );
}

/** The document at a `resource://` or `file://` URI, as text. */
function text(uri: string): string {
    const [, data] = Gio.File.new_for_uri(uri).load_contents(null);
    return new TextDecoder().decode(data);
}

export default async () => {
    await describe('the bundle carries what it says it carries', async () => {
        await it(`contains ${BUNDLED_ICON_COUNT} glyphs, all readable out of the GResource`, () => {
            const names = bundledNames();
            expect(names.length).toBe(BUNDLED_ICON_COUNT);
            // The GResource is zlib-COMPRESSED, which takes 53 % off it (43 377 B ->
            // 20 349 B) and is only safe because GIO decompresses on read. Reading one back
            // is what says so; a compressed resource GTK could not decode would look
            // identical from the outside until an icon failed to parse.
            const svg = text(`resource://${BUNDLED_ICON_RESOURCE_PATH}/scalable/actions/list-add-symbolic.svg`);
            expect(svg.includes('<svg')).toBe(true);
        });
    });

    await describe('arm 1: every bundled name resolves TO the bundle when it is authoritative', async () => {
        // The general form of the `legacy` defect in this file's header: a glyph filed in a
        // directory GTK does not scan is present, registered, and never drawn.
        await it('no bundled glyph is filed in a directory GTK never scans', () => {
            const theme = hostTheme(BUNDLED_ICON_THEME_NAME, true);
            const misfiled = bundledNames().filter(
                (name) => !drawnUri(theme, name).startsWith(`resource://${BUNDLED_ICON_RESOURCE_PATH}/`),
            );
            expect(misfiled).toStrictEqual([]);
        });
    });

    await describe('arm 2: the bundled glyph WINS where the host theme lacks the name', async () => {
        // This is the guarantee the whole feature exists for — an app on a host with no
        // Adwaita set. `BUNDLED_ICON_THEME_NAME` is a theme nothing installs, so the theme
        // chain contributes nothing and only the resource path can answer.
        await it('draws the app’s document, asserted by URI AND by bytes', () => {
            const bundlePath = `resource://${BUNDLED_ICON_RESOURCE_PATH}`;
            const before = drawnUri(hostTheme(BUNDLED_ICON_THEME_NAME, false), 'list-add-symbolic');
            const after = drawnUri(hostTheme(BUNDLED_ICON_THEME_NAME, true), 'list-add-symbolic');

            // Without the bundle something else answers — GTK's own builtin resource icons
            // on this build. WHICH other thing is not the claim; that it is not ours is.
            expect(before.startsWith(`${bundlePath}/`)).toBe(false);
            expect(after).toBe(`${bundlePath}/scalable/actions/list-add-symbolic.svg`);

            // The URI alone does not say the CONTENT is the glyph the bundle was built
            // from — a right path to a wrong document reads identically. So the bytes GTK
            // resolved to are compared with the bytes sitting in the GResource.
            const drawn = text(after);
            expect(drawn).toBe(text(`${bundlePath}/scalable/actions/list-add-symbolic.svg`));
            expect(drawn.includes('<svg')).toBe(true);
            if (before !== '') expect(drawn).not.toBe(text(before));
        });
    });

    await describe('arm 3: the host theme still wins where it HAS the name', async () => {
        // The limit, asserted rather than described. `add_resource_path` contributes, it
        // does not override — its GIR doc says so and this is the measurement. Overstating
        // the guarantee here is exactly how a reader would come to trust a glyph they are
        // not getting.
        await it('a host theme that ships the name is not displaced by the bundle', () => {
            const plain = hostTheme('Adwaita', false);
            if (!drawnUri(plain, 'list-add-symbolic').startsWith('file://')) {
                // No Adwaita installed on this host, so there is no override to observe.
                // Skipped rather than asserted-vacuously: a green arm here on a machine
                // with no icon themes would be the "checked nothing" failure.
                expect(drawnUri(plain, 'list-add-symbolic')).not.toBe('');
                return;
            }
            const host = drawnUri(plain, 'list-add-symbolic');
            const withBundle = drawnUri(hostTheme('Adwaita', true), 'list-add-symbolic');
            expect(withBundle).toBe(host);
            expect(withBundle.startsWith('resource://')).toBe(false);
        });
    });

    await describe('installBundledIconTheme', async () => {
        await it('does nothing at all for prefer: host — the documented way out', () => {
            expect(installBundledIconTheme({ prefer: 'host' })).toBe(false);
        });

        await it('is a no-op without a display rather than a throw', () => {
            // An app calls this on `startup`; a headless run must not take it down.
            expect(installBundledIconTheme({ display: null })).toBe(false);
            expect(installBundledIconTheme({ display: null, prefer: 'bundled' })).toBe(false);
        });

        await it('registers the GResource exactly once', () => {
            // `Gio.resources_register` of the same bytes twice leaves two registrations
            // holding the same paths, and the second is never unregistered.
            expect(registerBundledIconResource()).toBe(registerBundledIconResource());
        });
    });
};
