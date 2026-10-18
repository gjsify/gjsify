// `Adw.Carousel`'s GIR page and position doors on the REAL NS widget, held to the
// CAROUSEL_DOOR_VECTORS real `gi://Adw` passes. The NS model is authoritative — it lands
// the instant `scroll_to` is called, animated or not — so `settle` has nothing to wait for.
//
// This lives on the TREES entry (`src/test.trees.mts`): it builds the port's real widget
// classes, which evaluate `@nativescript/core` at module scope.

import { describe, expect, it } from '@gjsify/unit';
import {
    CAROUSEL_DOOR_VECTORS,
    driveCarouselDoorVectors,
    type CarouselDoorLike,
} from '@gjsify/adwaita-core/conformance';

import * as Adw from './namespace/adw.js';
import * as Gtk from './namespace/gtk.js';

export const AdwCarouselDoorsNsTest = async () => {
    await driveCarouselDoorVectors(
        {
            name: 'NativeScript Adw.Carousel',
            isOracle: false,
            makeCarousel(count) {
                const carousel = new Adw.Carousel();
                const pages = Array.from({ length: count }, (_unused, i) => new Gtk.Label({ label: `Page ${i}` }));
                for (const page of pages) carousel.append(page);
                return { carousel: carousel as unknown as CarouselDoorLike, pages };
            },
            makeStranger: () => new Gtk.Label({ label: 'Stranger' }),
            async settle() {},
            dispose() {},
        },
        { describe, it, expect },
        CAROUSEL_DOOR_VECTORS,
    );
};
