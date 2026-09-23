// AdwCarouselIndicatorDots — a row of dots marking an `AdwCarousel`'s pages, for
// NativeScript. The binding and the marker logic are `carousel-indicator-base.ts`'s; this is
// the dot look.
//
// Reference: refs/libadwaita/src/adw-carousel-indicator-dots.c
// Copyright (c) GNOME contributors (libadwaita). LGPLv2.1+.

import { AdwCarouselIndicatorBase } from './carousel-indicator-base.js';
import { applyConstructProps, type ConstructProps } from './construct-props.js';

export class AdwCarouselIndicatorDots extends AdwCarouselIndicatorBase {
    protected readonly _markerClass = 'adw-carousel-dot';
    protected readonly _markerText = '●';

    constructor(props?: ConstructProps<AdwCarouselIndicatorDots>) {
        super('adw-carousel-indicator-dots');
        applyConstructProps(this, props);
    }
}
