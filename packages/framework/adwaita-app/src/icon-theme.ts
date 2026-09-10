// The bundled Adwaita icon theme — the GTK half of "the app ships its own glyphs".
//
// THE HOLE THIS CLOSES. `iconName: 'list-add-symbolic'` on GTK resolves against whatever
// icon theme the HOST has installed, and nothing guarantees that is Adwaita. Measured
// repo-wide before this landed: `add_resource_path` and `add_search_path` had ZERO hits
// in every `.ts`/`.js`/`.mjs`/`.tmpl`/`.blp` outside `node_modules`, so every gjsify GTK
// app drew the host's theme and nothing in the tree noticed. On a host without Adwaita a
// documented name drew the broken-image paintable.
//
// The other two renderers already close it: `@gjsify/adwaita-web` compiles a subset into
// its stylesheet with `registerIcon()` as the door
// (`packages/web/adwaita-web/src/icon-registry.ts`), and the NativeScript port compiles a
// subset behind the same property name. This is the third, and it is the same shape:
// same property, same name, same glyph, no dependency on the host.
//
// WHAT `add_resource_path` ACTUALLY GUARANTEES, and what it does not. Its own GIR doc is
// precise — it "make[s] application-specific icons available as part of the icon theme",
// i.e. it CONTRIBUTES, it does not override. Measured on gtk4 by asking
// `Gtk.IconTheme.lookup_icon(...).get_file().get_uri()`, which is the file the widget
// paints rather than a claim that a path was registered:
//
//   host theme has the name (Adwaita)      ->  file:///usr/share/icons/Adwaita/…  host wins
//   host theme lacks it (oxygen, Bluecurve) ->  resource:///…                     bundle wins
//   hicolor only                            ->  resource:///…                     bundle wins
//
// So the DEFAULT here fixes the failure that motivated it — a name never fails to resolve,
// on any host — while leaving a user who deliberately chose Papirus with Papirus. That is
// how a desktop app should behave, and it is what every GNOME app that ships icons does.
//
// {@link BundledIconPreference} `'bundled'` is the opt-in for the case where the SHIPPED
// glyph matters more than the host's taste: a screenshot rig, a kiosk, a documentation
// gallery whose pictures have to match the prose. It works by pointing the icon theme at a
// theme name NOTHING installs, so the theme chain contributes nothing and the resource
// path is the only thing left holding the name. That is the whole trick, and its cost is
// stated in {@link installBundledIconTheme}: any name OUTSIDE the bundle then has only
// GTK's own builtin resource icons behind it.
//
// Copyright (c) GNOME contributors (libadwaita / adwaita-icon-theme). LGPLv2.1+ / CC-BY-SA
// — the icon SVGs. Original implementation.

import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GLib from 'gi://GLib?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';

import { BUNDLED_ICON_COUNT, BUNDLED_ICON_GRESOURCE_BASE64, BUNDLED_ICON_RESOURCE_PATH } from './icons.generated.js';

export { BUNDLED_ICON_COUNT, BUNDLED_ICON_RESOURCE_PATH };

/**
 * The theme name `'bundled'` points the icon theme at.
 *
 * Deliberately a name no icon theme on any system installs: GTK then finds no `index.theme`
 * for it, the theme chain contributes nothing, and the resource path is what answers every
 * lookup. A REAL theme name here would put that theme's glyphs back in front of the bundle.
 */
export const BUNDLED_ICON_THEME_NAME = 'gjsify-adwaita-bundled';

/**
 * How the app's shipped icons relate to the host's icon theme.
 *
 * - `'fallback'` (default) — the host theme wins where it has the name; the bundle fills
 *   every hole, so a name always resolves. Respects a user's chosen theme.
 * - `'bundled'` — the shipped set is authoritative and the host theme is not consulted.
 *   Guarantees the documented glyph; costs the host's look, and any name outside the
 *   bundle falls back only to GTK's own builtins.
 * - `'host'` — register nothing. The documented way out for an app that wants exactly the
 *   behaviour gjsify had before this existed.
 */
export type BundledIconPreference = 'fallback' | 'bundled' | 'host';

export interface BundledIconThemeOptions {
    /** Default `'fallback'`. See {@link BundledIconPreference}. */
    prefer?: BundledIconPreference;
    /**
     * The display whose icon theme to touch. Defaults to `Gdk.Display.get_default()`;
     * `null` with no default display is a no-op that RETURNS FALSE rather than throwing,
     * because an app calling this on `startup` may legitimately be running headless.
     */
    display?: Gdk.Display | null;
}

/** Registered once per process — a second `Gio.resources_register` of the same bytes leaks. */
let registered: Gio.Resource | null = null;

/**
 * Register the bundled GResource with GIO, once.
 *
 * Exported because {@link addBundledIconsToTheme} is useful on a bare `Gtk.IconTheme`
 * (that is how the specs prove which glyph wins, with no display in sight) and both need
 * the resource to exist first.
 */
export function registerBundledIconResource(): Gio.Resource {
    if (registered) return registered;
    const bytes = GLib.base64_decode(BUNDLED_ICON_GRESOURCE_BASE64);
    registered = Gio.Resource.new_from_data(new GLib.Bytes(bytes));
    Gio.resources_register(registered);
    return registered;
}

/**
 * Point one `Gtk.IconTheme` at the bundled icons.
 *
 * Split out from {@link installBundledIconTheme} so the effect can be asserted on a theme
 * object a test constructs — `Gtk.IconTheme.new()` takes a theme name, which the display's
 * theme refuses ("This function cannot be called on the icon theme objects returned from
 * gtk_icon_theme_get_for_display"), so the two paths reach `'bundled'` differently and only
 * this one is drivable without a display.
 */
export function addBundledIconsToTheme(theme: Gtk.IconTheme): void {
    registerBundledIconResource();
    theme.add_resource_path(BUNDLED_ICON_RESOURCE_PATH);
}

/**
 * Make the app's shipped Adwaita glyphs available to every `icon-name` in the process.
 *
 * Called for you by `runAdwaitaApp`/`AdwaitaApp` on `startup`; call it yourself only if
 * you build the `Adw.Application` some other way. Idempotent.
 *
 * Returns whether anything was installed — `false` for `'host'`, and `false` when there is
 * no display to install onto.
 *
 * THE `'bundled'` PATH GOES THROUGH `Gtk.Settings`, not through `IconTheme.set_theme_name`,
 * and that is not a style choice: the setter refuses on a display's theme, so the theme
 * NAME can only be changed through the setting that feeds it. The consequence worth knowing
 * is that this overrides the user's icon theme for the whole process, which is why it is
 * not the default.
 */
export function installBundledIconTheme(options: BundledIconThemeOptions = {}): boolean {
    const prefer = options.prefer ?? 'fallback';
    if (prefer === 'host') return false;

    const display = options.display === undefined ? Gdk.Display.get_default() : options.display;
    if (!display) return false;

    addBundledIconsToTheme(Gtk.IconTheme.get_for_display(display));

    if (prefer === 'bundled') {
        const settings = Gtk.Settings.get_for_display(display);
        settings.set_property('gtk-icon-theme-name', BUNDLED_ICON_THEME_NAME);
    }
    return true;
}
