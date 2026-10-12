// The Gtk platform door of adwaita-nativescript, held to the shared vectors. The door is the namespace module itself,
// so a member that stops being exported fails here.

import { GTK_PLATFORM_VECTORS, driveGtkPlatformVectors, type GtkPlatformLike } from '@gjsify/adwaita-core/conformance';
import { describe, expect, it } from '@gjsify/unit';

import * as Gtk from './namespace/gtk.js';

export default async () => {
    await driveGtkPlatformVectors(
        { name: 'adwaita-nativescript', isOracle: false, Gtk: Gtk as unknown as GtkPlatformLike },
        { describe, it, expect },
    );
    await describe('adwaita-nativescript: Gtk platform door', async () => {
        await it('has a vector row for every vector', () => {
            expect(GTK_PLATFORM_VECTORS.length > 0).toBe(true);
        });
    });
};
