// THE ORACLE: the view vectors against real `gi://GtkSource` and `gi://Gtk`. A vector that fails here
// is a wrong vector; fix the vector. The defaults read pspecs; the surface vectors build a view, which
// needs a display, so they run only where `Gtk.init_check()` finds one.

import { describe, expect, it, on } from '@gjsify/unit';

import {
    GTKSOURCE_VIEW_DEFAULT_VECTORS,
    GTKSOURCE_VIEW_SURFACE_VECTORS,
    type GtkSourceViewSurfaceLike,
} from './view-vectors.js';

export default async () => {
    await on('Gjs', async () => {
        const GtkSource = (await import('gi://GtkSource?version=5' as string))
            .default as GtkSourceViewSurfaceLike['GtkSource'] & {
            View: { find_property(name: string): { get_default_value(): unknown } };
        };
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default as GtkSourceViewSurfaceLike['Gtk'] & {
            init_check(): boolean;
        };
        await describe('GJS (real GtkSource): View defaults', async () => {
            for (const vector of GTKSOURCE_VIEW_DEFAULT_VECTORS) {
                await it(vector.property, () => {
                    expect(GtkSource.View.find_property(vector.property).get_default_value()).toStrictEqual(
                        vector.shows,
                    );
                });
            }
        });
        const display = Gtk.init_check();
        await describe(`GJS (real GtkSource): View surface (display: ${display})`, async () => {
            for (const vector of GTKSOURCE_VIEW_SURFACE_VECTORS) {
                if (vector.instance && !display) continue;
                await it(vector.rule, () => {
                    expect(vector.observe({ Gtk, GtkSource })).toStrictEqual(vector.shows);
                });
            }
        });
    });
};
