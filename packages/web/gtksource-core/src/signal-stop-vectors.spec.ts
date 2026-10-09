import { describe, expect, it } from '@gjsify/unit';

import { Buffer } from './buffer.js';
import { STOP_EMISSION } from '@gjsify/adwaita-core';
import {
    GTKSOURCE_STOP_VECTORS,
    type GtkSourceStopGestures,
    type GtkSourceStopSurface,
} from './signal-stop-vectors.js';

// The core has no GObject; the doors route `signal_stop_emission_by_name` to this symbol.
const surface = {
    GtkSource: { Buffer },
    GObject: {
        signal_stop_emission_by_name: (instance: object, name: string) =>
            (instance as { [STOP_EMISSION](name: string): void })[STOP_EMISSION](name),
    },
} as unknown as GtkSourceStopSurface;

const noGestures = {} as GtkSourceStopGestures;

export default async () => {
    await describe('gtksource-core: stopping an emission, the buffer vectors', async () => {
        for (const vector of GTKSOURCE_STOP_VECTORS.filter((v) => !v.view)) {
            await it(vector.rule, () => {
                expect(vector.observe(surface, noGestures)).toStrictEqual(vector.shows);
            });
        }
    });
};
