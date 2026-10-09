// THE ORACLE: GTKSOURCE_VIEW_DEFAULT_VECTORS against the pspecs of real `gi://GtkSource`. A vector
// that fails here is a wrong vector; fix the vector.

import { describe, expect, it, on } from '@gjsify/unit';

import { GTKSOURCE_VIEW_DEFAULT_VECTORS } from './view-vectors.js';

export default async () => {
    await on('Gjs', async () => {
        const GtkSource = (await import('gi://GtkSource?version=5' as string)).default as {
            View: { find_property(name: string): { get_default_value(): unknown } };
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
    });
};
