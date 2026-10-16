// ADR 0116 §§ 3–4 on the web: the `Gio` resource subset through the `Gio` door, the shared
// icon theme's resource paths through the lookup `<gtk-image>` uses, and what it then paints.
// Real GJS is the oracle for both vector sets, in adwaita-core's `*.gjs.spec.ts`.
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

import { COLOR_ICON_CLASS, type GtkImage } from './elements/gtk-image.js';
import { resourceIcon } from './icon-theme.js';
import { GLib, Gio, Gtk } from './index.js';

const theme = Gtk.IconTheme.get_for_display(null);

const iconSubject: IconThemeResourceSubject = {
    name: 'adwaita-web',
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
        const found = resourceIcon(name, { size, scale, direction });
        if (found === null) return null;
        if (found.kind === 'resource') return { uri: `resource://${found.path}`, symbolic: found.symbolic };
        return found.kind === 'symbolic' ? 'theme' : null;
    },
};

/** Mounts `<gtk-image>` for each name with the fixture's icons on the theme's resource path. */
async function withIcons(run: (image: (name: string, size?: number) => GtkImage) => Promise<void> | void) {
    const resource = Gio.Resource.new_from_data(gioResourceFixtures().icons);
    Gio.resources_register(resource);
    const before = theme.get_resource_path();
    theme.add_resource_path(ICON_FIXTURE_PATH);
    // `changed` is deferred: let it drop the previous scan's URLs (and their warnings) first.
    await new Promise((resolve) => setTimeout(resolve, 0));
    const host = document.createElement('div');
    document.body.append(host);
    try {
        await run((name, size) => {
            const el = document.createElement('gtk-image') as GtkImage;
            if (size !== undefined) el.setAttribute('size', String(size));
            el.setAttribute('icon-name', name);
            host.append(el);
            return el;
        });
    } finally {
        host.remove();
        theme.set_resource_path(before);
        Gio.resources_unregister(resource);
    }
}

export const GioResourceTest = async () => {
    await driveGioResourceVectors(
        {
            name: 'adwaita-web',
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

    await describe('adwaita-web: <gtk-image> draws resource icons (ADR 0116 § 4)', async () => {
        await it('draws a symbolic file as an inline mask in currentColor', async () => {
            await withIcons((image) => {
                const el = image('sym-symbolic', 16);
                expect(el.style.getPropertyValue('mask-image').startsWith('url("blob:')).toBe(true);
                expect(el.style.backgroundColor).toBe('currentcolor');
                expect(el.classList.contains(COLOR_ICON_CLASS)).toBe(false);
            });
        });

        await it('draws a colour file as-is, without a mask', async () => {
            await withIcons((image) => {
                const el = image('flat');
                expect(el.classList.contains(COLOR_ICON_CLASS)).toBe(true);
                expect(el.style.backgroundImage.startsWith('url("blob:')).toBe(true);
                expect(el.style.getPropertyValue('mask-image')).toBe('');
            });
        });

        await it('draws image-missing for a file a browser cannot draw', async () => {
            await withIcons((image) => {
                const warn = console.warn;
                const warned: unknown[] = [];
                console.warn = (...args: unknown[]) => warned.push(args);
                try {
                    const el = image('old');
                    expect(el.classList.contains('adw-icon--image-missing')).toBe(true);
                    expect(el.style.backgroundImage).toBe('');
                    expect(warned.length > 0).toBe(true);
                } finally {
                    console.warn = warn;
                }
            });
        });

        await it("prefers the current theme's glyph over a resource of the same name", async () => {
            await withIcons((image) => {
                const el = image('go-next-symbolic', 16);
                expect(el.classList.contains('adw-icon--go-next')).toBe(true);
                expect(el.style.getPropertyValue('mask-image')).toBe('');
            });
        });

        await it('clears the inline drawing when the name changes to a theme glyph', async () => {
            await withIcons((image) => {
                const el = image('sym-symbolic', 16);
                el.setAttribute('icon-name', 'go-next-symbolic');
                expect(el.style.getPropertyValue('mask-image')).toBe('');
                expect(el.style.backgroundColor).toBe('');
            });
        });
    });
};
