// NativeScript port of the Carousel stories. Shares metadata with the GTK
// carousel.story.ts and browser carousel.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel). Adw.Carousel ships two
// indicator widgets, so this module exports two stories (Dots + Lines),
// mirroring the native + browser twins.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { Label, StackLayout, type View } from '@nativescript/core';
import { carouselDotsMeta, carouselLinesMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The three pages, mirroring the native (Welcome / Discover / Get started) demo.
const PAGES: ReadonlyArray<{ title: string; accent: string }> = [
    { title: 'Welcome', accent: 'accent' },
    { title: 'Discover', accent: 'success' },
    { title: 'Get started', accent: 'warning' },
];

/** Per-page width (DIPs) used by the carousel's offset math. */
const PAGE_WIDTH = 440;

/** Build a single accent-tinted card page, sized like the native demo. */
function buildPage(title: string, accent: string): View {
    const card = new StackLayout();
    card.orientation = 'vertical';
    card.height = 260;
    card.verticalAlignment = 'middle';
    card.className = `adw-card ${accent}`;

    const label = new Label();
    label.text = title;
    // .title-1 in libadwaita ≈ 24pt bold.
    label.className = 'title-1';
    label.horizontalAlignment = 'center';
    label.verticalAlignment = 'middle';
    card.addChild(label);

    return card;
}

/**
 * Shared body for both indicator variants. The NS Adw.Carousel renders its own
 * built-in dot row, so both stories share the identical tree — the line vs dot
 * indicator distinction has no NS equivalent (see fidelity note in report).
 */
abstract class CarouselNsStoryBase extends StoryView {
    private _carousel: Adw.Carousel | null = null;

    initialize(): void {
        const carousel = new Adw.Carousel();
        carousel.pageWidth = PAGE_WIDTH;
        for (const page of PAGES) {
            carousel.addPage(buildPage(page.title, page.accent));
        }
        this._carousel = carousel;
        // allowScrollWheel / allowLongSwipes have no NS equivalent (no swipe-snap
        // in the CSS subset); we still read them in updateArgs to keep the live
        // binding contract identical to the twins.
        this._syncCarousel();
        this.addContent(carousel);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncCarousel();
    }

    private _syncCarousel(): void {
        if (!this._carousel) return;
        // No NS-visible effect, but read the args so the control stays bound.
        void (this.args.allowScrollWheel as boolean);
        void (this.args.allowLongSwipes as boolean);
    }
}

/** Story: carousel with dot indicators (the NS carousel's native indicator). */
export class CarouselDotsNsStory extends CarouselNsStoryBase {
    constructor() {
        super(CarouselDotsNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return carouselDotsMeta;
    }
}

/** Story: carousel with line indicators (approximated by the same dot row). */
export class CarouselLinesNsStory extends CarouselNsStoryBase {
    constructor() {
        super(CarouselLinesNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return carouselLinesMeta;
    }
}

export const CarouselNsStories: NsStoryModule = { stories: [CarouselDotsNsStory, CarouselLinesNsStory] };
