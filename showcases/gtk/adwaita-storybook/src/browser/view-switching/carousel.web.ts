// Browser port of the Carousel stories — adw-carousel with three card pages,
// paired with the dot / line page indicators. Shares its metadata/controls with
// the GTK twin (carousel.story.ts). Adw.Carousel has two indicator widgets, so
// this module exports two stories (Dots + Lines), mirroring the native file.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { carouselDotsMeta, carouselLinesMeta } from '../../view-switching/carousel.meta.js';

// Subtle tints over the window background — libadwaita's .card.accent/.success/
// .warning are a faint colour wash on the card, not a saturated fill.
const PAGES: ReadonlyArray<{ title: string; accent: string }> = [
    { title: 'Welcome', accent: 'color-mix(in srgb, var(--accent-bg-color) 14%, var(--window-bg-color))' },
    { title: 'Discover', accent: 'color-mix(in srgb, #2ec27e 14%, var(--window-bg-color))' },
    { title: 'Get started', accent: 'color-mix(in srgb, #e5a50a 14%, var(--window-bg-color))' },
];

let nextCarouselId = 0;

/** Build a single accent-tinted card page, sized like the native demo. */
function buildPage(title: string, accent: string): HTMLElement {
    const card = document.createElement('adw-card');
    card.style.cssText = [
        'width:440px',
        'height:260px',
        'display:flex',
        'align-items:center',
        'justify-content:center',
        `background-color:${accent}`,
        'color:#ffffff',
        'box-sizing:border-box',
    ].join(';');

    const label = document.createElement('span');
    label.textContent = title;
    // .title-1 in libadwaita ≈ 24pt bold.
    label.style.cssText = 'font-size:24pt;font-weight:800;';
    card.appendChild(label);
    return card;
}

/** Shared body for both indicator variants — only the indicator tag differs. */
abstract class CarouselWebStoryBase extends StoryElement {
    private _carousel: HTMLElement | null = null;

    /** The indicator tag this variant pairs with the carousel. */
    protected abstract indicatorTag(): string;

    initialize(): void {
        const carousel = document.createElement('adw-carousel');
        carousel.id = `adw-carousel-${nextCarouselId++}`;
        carousel.style.cssText = 'width:480px;height:280px;';
        carousel.toggleAttribute('allow-scroll-wheel', this.args.allowScrollWheel as boolean);
        carousel.toggleAttribute('allow-long-swipes', this.args.allowLongSwipes as boolean);
        for (const page of PAGES) {
            carousel.appendChild(buildPage(page.title, page.accent));
        }
        this._carousel = carousel;

        const indicator = document.createElement(this.indicatorTag());
        indicator.setAttribute('for', carousel.id);

        const box = document.createElement('div');
        box.style.cssText = 'display:flex;flex-direction:column;gap:12px;width:480px;align-items:center;';
        box.append(carousel, indicator);

        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._carousel) return;
        this._carousel.toggleAttribute('allow-scroll-wheel', this.args.allowScrollWheel as boolean);
        this._carousel.toggleAttribute('allow-long-swipes', this.args.allowLongSwipes as boolean);
    }
}

/** Story: adw-carousel with dot indicators. */
export class CarouselDotsWebStory extends CarouselWebStoryBase {
    constructor() {
        super(CarouselDotsWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return carouselDotsMeta;
    }

    protected indicatorTag(): string {
        return 'adw-carousel-indicator-dots';
    }
}

/** Story: adw-carousel with line indicators. */
export class CarouselLinesWebStory extends CarouselWebStoryBase {
    constructor() {
        super(CarouselLinesWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return carouselLinesMeta;
    }

    protected indicatorTag(): string {
        return 'adw-carousel-indicator-lines';
    }
}

export const CarouselWebStories: WebStoryModule = { stories: [CarouselDotsWebStory, CarouselLinesWebStory] };
