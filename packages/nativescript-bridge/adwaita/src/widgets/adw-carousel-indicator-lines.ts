// AdwCarouselIndicatorLines — a row of short lines marking an `AdwCarousel`'s pages, for
// NativeScript. The binding and the marker logic are `carousel-indicator-base.ts`'s; this is
// the line look, which the theme draws as a filled bar with no text.
//
// Reference: refs/libadwaita/src/adw-carousel-indicator-lines.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { AdwCarouselIndicatorBase } from './carousel-indicator-base.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

export class AdwCarouselIndicatorLines extends AdwCarouselIndicatorBase {
    protected readonly _markerClass = 'adw-carousel-line';
    protected readonly _markerText = '';

    constructor(props?: ConstructProps<AdwCarouselIndicatorLines>) {
        super('adw-carousel-indicator-lines');
        applyConstructProps(this, props);
    }
}
