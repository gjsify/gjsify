// `Gtk.IconSize` on a target that has no GI — the nick table and the size it resolves to.
//
// Drives the pure helper, never a widget: a widget module's `extends Image` evaluates a
// bare `@nativescript/core` specifier at module eval, which is unresolvable off a device
// (packages/nativescript-bridge/AGENTS.md § the UI-widget exception).

import { describe, expect, it } from '@gjsify/unit';

import {
    DEFAULT_ICON_PIXEL_SIZE,
    GTK_ICON_SIZE_NICKS,
    GTK_ICON_SIZE_PIXELS,
    gtkIconSizeNick,
    iconPixelSize,
} from './widgets/gtk-icon-size.js';

export default async (): Promise<void> => {
    await describe('Gtk.IconSize', async () => {
        await it('has exactly the three members GTK declares, in GIR order', () => {
            // Held against `GtkIconSizeNick` in gtk-host's generated props by arm 7 of
            // `check-nativescript-xml-doors.mjs`; asserted literally here so the table
            // cannot drift without a test being edited to say so.
            expect([...GTK_ICON_SIZE_NICKS]).toStrictEqual(['inherit', 'normal', 'large']);
        });

        await it('resolves each nick to the size GTK renders it at', () => {
            // MEASURED on GTK 4.22.4 (gjs 1.88.1, `Gtk.Image` with `icon_name` set,
            // presented and then `measure()`d on both axes):
            //   INHERIT: 16x16, no css class
            //   NORMAL:  16x16, `.normal-icons`
            //   LARGE:   32x32, `.large-icons`
            expect(GTK_ICON_SIZE_PIXELS.inherit).toBe(16);
            expect(GTK_ICON_SIZE_PIXELS.normal).toBe(16);
            expect(GTK_ICON_SIZE_PIXELS.large).toBe(32);
            expect(DEFAULT_ICON_PIXEL_SIZE).toBe(16);
        });

        await it('takes the three nicks and REFUSES anything else by name', () => {
            expect(gtkIconSizeNick('large', 'normal')).toBe('large');
            expect(gtkIconSizeNick('inherit', 'normal')).toBe('inherit');
            // The defect this exists for: `<gtk:Image iconSize="large">` used to reach a
            // `number` setter, fail `xmlNumber`, and silently render at 16. A value that
            // is not a member must now be told apart from a member — a typo, a GTK
            // documentation value and a deliberate choice cannot keep producing the same
            // silent result.
            expect(() => gtkIconSizeNick('larg', 'normal')).toThrow();
            expect(() => gtkIconSizeNick('32', 'normal')).toThrow();
            expect(() => gtkIconSizeNick(32, 'normal')).toThrow();
            expect(() => gtkIconSizeNick(null, 'normal')).toThrow();
        });

        await it('names the member it could not find, and the three it accepts', () => {
            let message = '';
            try {
                gtkIconSizeNick('larg', 'normal');
            } catch (error) {
                message = error instanceof Error ? error.message : String(error);
            }
            expect(message.includes('larg')).toBe(true);
            for (const nick of GTK_ICON_SIZE_NICKS) expect(message.includes(nick)).toBe(true);
        });

        await it('lets an explicit pixel size win over the icon size, as `Gtk.Image` does', () => {
            // `gtk_image_set_pixel_size` documents the override: a pixel-size of -1 (unset)
            // leaves `icon-size` in charge, any other value takes precedence.
            expect(iconPixelSize('large', null)).toBe(32);
            expect(iconPixelSize('normal', null)).toBe(16);
            expect(iconPixelSize('large', 12)).toBe(12);
            expect(iconPixelSize('normal', 48)).toBe(48);
        });

        await it('treats a non-positive pixel size as unset rather than as a size', () => {
            // GTK's own sentinel is -1, and a 0-DIP image is not a rendering anyone asked
            // for — both mean "the icon size decides".
            expect(iconPixelSize('large', -1)).toBe(32);
            expect(iconPixelSize('large', 0)).toBe(32);
            expect(iconPixelSize('normal', Number.NaN)).toBe(16);
        });
    });
};
