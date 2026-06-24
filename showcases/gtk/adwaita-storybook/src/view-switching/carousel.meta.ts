// Shared, renderer-agnostic metadata for the Carousel stories. Imported by both
// the GTK renderer (carousel.story.ts) and the browser renderer
// (browser/view-switching/carousel.web.ts) so the two expose identical controls.
// Adw.Carousel ships two indicator widgets, so there are two stories — one
// paired with dot indicators, one with line indicators.

import { ControlType, type StoryMeta } from '@gjsify/stories';

const carouselControls: StoryMeta['controls'] = [
    {
        name: 'allowScrollWheel',
        label: 'Allow scroll wheel',
        type: ControlType.BOOLEAN,
        defaultValue: true,
    },
    {
        name: 'allowLongSwipes',
        label: 'Allow long swipes',
        type: ControlType.BOOLEAN,
        defaultValue: false,
    },
];

export const carouselDotsMeta: StoryMeta = {
    title: 'View Switching/Carousel (Dots)',
    description:
        'Adw.Carousel — a horizontally swipeable pager with three pages, paired with Adw.CarouselIndicatorDots.',
    controls: carouselControls,
};

export const carouselLinesMeta: StoryMeta = {
    title: 'View Switching/Carousel (Lines)',
    description: 'Adw.Carousel — the same swipeable pager paired with Adw.CarouselIndicatorLines instead of dots.',
    controls: carouselControls,
};
