// THE ORACLE: the GTKSOURCE_STOP_VECTORS run against real `gi://GtkSource`. A vector that fails here
// is a wrong vector; fix the vector. The view rows need a display and are skipped without one.

import { describe, expect, it, on } from '@gjsify/unit';

import {
    GTKSOURCE_STOP_VECTORS,
    type GtkSourceStopGestures,
    type GtkSourceStopSurface,
    type StoppableViewLike,
} from './signal-stop-vectors.js';

export default async () => {
    await on('Gjs', async () => {
        const GtkSource = (await import('gi://GtkSource?version=5' as string)).default;
        const GObject = (await import('gi://GObject' as string)).default;
        const Gtk = (await import('gi://Gtk?version=4.0' as string)).default;
        const display = Gtk.init_check();
        const surface = { GtkSource, GObject } as unknown as GtkSourceStopSurface;
        const gestures: GtkSourceStopGestures = {
            extendSelection: (view: StoppableViewLike, offset: number) => {
                const iter = view.buffer.get_start_iter();
                iter.set_offset(offset);
                const handled = (view as unknown as { emit(...a: unknown[]): boolean }).emit(
                    'extend-selection',
                    0,
                    iter,
                    iter.copy(),
                    iter.copy(),
                );
                return handled ? 'native' : [offset, offset];
            },
            copyClipboard: (view) => (view as unknown as { emit(n: string): void }).emit('copy-clipboard'),
        };
        await describe('GJS (real GtkSource): stopping an emission', async () => {
            for (const vector of GTKSOURCE_STOP_VECTORS) {
                if (vector.view && !display) continue;
                await it(vector.rule, () => {
                    expect(vector.observe(surface, gestures)).toStrictEqual(vector.shows);
                });
            }
        });
    });
};
