// ADR 0116 §§ 3–4 on NativeScript: the `Gio` resource subset through the `Gio` door, the shared
// icon theme's resource paths through the lookup `Gtk.Image` draws with, and what it then draws.
// Real GJS is the oracle for both vector sets, in adwaita-core's `*.gjs.spec.ts`. On the TREES entry
// because the doors and the image reach `@nativescript/core`.
import {
    GIO_RESOURCE_VECTORS,
    ICON_FIXTURE_PATH,
    ICON_THEME_RESOURCE_VECTORS,
    driveGioResourceVectors,
    driveIconThemeResourceVectors,
    gioResourceFixtures,
    type IconThemeResourceSubject,
} from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import { ImageSource } from '@nativescript/core';

import { lookupThemeIcon } from './widgets/icon-theme.js';
import * as GLib from './namespace/glib.js';
import * as Gio from './namespace/gio.js';
import * as Gtk from './namespace/gtk.js';

const theme = Gtk.IconTheme.get_for_display(null);

const iconSubject: IconThemeResourceSubject = {
    name: 'adwaita-nativescript',
    isOracle: false,
    register(data) {
        const resource = Gio.Resource.new_from_data(data);
        Gio.resources_register(resource);
        return () => Gio.resources_unregister(resource);
    },
    theme() {
        theme.set_resource_path([]);
        return theme;
    },
    lookup(_theme, name, size, scale, direction) {
        const found = lookupThemeIcon(theme, name, { size, scale, direction });
        if (found === null) return null;
        if (found.kind === 'resource') return { uri: `resource://${found.path}`, symbolic: found.symbolic };
        return 'theme';
    },
};

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

/** Builds a loaded `Gtk.Image` per name with the fixture's icons on the theme's resource path. */
async function withIcons(run: (image: (name: string) => Gtk.Image) => Promise<void> | void) {
    const resource = Gio.Resource.new_from_data(gioResourceFixtures().icons);
    Gio.resources_register(resource);
    const before = theme.get_resource_path();
    theme.add_resource_path(ICON_FIXTURE_PATH);
    // `changed` is deferred: let it drop the previous scan's drawings first.
    await tick();
    const images: Gtk.Image[] = [];
    try {
        await run((name) => {
            const image = new Gtk.Image({ iconName: name, pixelSize: 16 });
            image.notify({ eventName: 'loaded', object: image as never });
            images.push(image);
            return image;
        });
    } finally {
        for (const image of images) image.notify({ eventName: 'unloaded', object: image as never });
        theme.set_resource_path(before);
        Gio.resources_unregister(resource);
    }
}

/** What the double's `ImageSource.fromBase64Sync` keeps; a device's holds a native bitmap. */
const base64Of = (image: Gtk.Image) =>
    (image.imageSource as { nativeSource?: { base64?: string } } | undefined)?.nativeSource?.base64;

const fileBase64 = (subpath: string) =>
    btoa(String.fromCharCode(...Gio.resources_lookup_data(`${ICON_FIXTURE_PATH}${subpath}`, 0).get_data()));

export const GioResourceNsTest = async () => {
    await driveGioResourceVectors(
        {
            name: 'adwaita-nativescript',
            isOracle: false,
            Gio: Gio as never,
            bytes: (data) => new GLib.Bytes(data),
        },
        { describe, it, expect },
        GIO_RESOURCE_VECTORS,
    );

    const before = theme.get_resource_path();
    try {
        await driveIconThemeResourceVectors(iconSubject, { describe, it, expect }, ICON_THEME_RESOURCE_VECTORS);
    } finally {
        theme.set_resource_path(before);
    }

    await describe('adwaita-nativescript: Gtk.Image draws resource icons (ADR 0116 § 4)', async () => {
        await it('draws a PNG file as it is, untinted', async () => {
            await withIcons((image) => {
                const el = image('flat');
                expect(el.imageSource instanceof ImageSource).toBe(true);
                expect(base64Of(el)).toBe(fileBase64('flat.png'));
                expect(el.tintColor).toBe(undefined);
            });
        });

        await it('tints a .symbolic.png in the icon colour', async () => {
            await withIcons((image) => {
                const el = image('tint');
                el.iconColor = '#ff0000';
                expect(base64Of(el)).toBe(fileBase64('16x16/apps/tint.symbolic.png'));
                expect(el.tintColor).toBe('#ff0000');
            });
        });

        await it('redraws once the theme changes, as a GtkImage redoes its lookup', async () => {
            const resource = Gio.Resource.new_from_data(gioResourceFixtures().icons);
            const saved = theme.get_resource_path();
            theme.set_resource_path([]);
            await tick();
            const el = new Gtk.Image({ iconName: 'flat', pixelSize: 16 });
            el.notify({ eventName: 'loaded', object: el as never });
            Gio.resources_register(resource);
            try {
                expect(base64Of(el)).toBe(undefined);
                theme.add_resource_path(ICON_FIXTURE_PATH);
                await tick();
                expect(base64Of(el)).toBe(fileBase64('flat.png'));
            } finally {
                el.notify({ eventName: 'unloaded', object: el as never });
                theme.set_resource_path(saved);
                Gio.resources_unregister(resource);
            }
        });
    });
};
