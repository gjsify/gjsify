// Adw.Carousel — a swipeable pager paired with page indicators. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { carouselDotsMeta, carouselLinesMeta } from './carousel.meta.js';

const PAGES: ReadonlyArray<{ title: string; css: string }> = [
    { title: 'Welcome', css: 'accent' },
    { title: 'Discover', css: 'success' },
    { title: 'Get started', css: 'warning' },
];

function buildPage(title: string, cssClass: string): Gtk.Widget {
    const box = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
        widthRequest: 440,
        heightRequest: 260,
    });
    box.add_css_class('card');
    box.add_css_class(cssClass);

    const label = new Gtk.Label({ label: title, vexpand: true, valign: Gtk.Align.CENTER });
    label.add_css_class('title-1');
    box.append(label);

    return box;
}

/** Story: Adw.Carousel with dot indicators. */
export class CarouselDotsStory extends StoryWidget {
    private _carousel: Adw.Carousel | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookCarouselDots' }, CarouselDotsStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(CarouselDotsStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...carouselDotsMeta, component: Adw.Carousel.$gtype };
    }

    initialize(): void {
        this._carousel = new Adw.Carousel({
            allowScrollWheel: this.args.allowScrollWheel as boolean,
            allowLongSwipes: this.args.allowLongSwipes as boolean,
            vexpand: true,
        });
        for (const page of PAGES) {
            this._carousel.append(buildPage(page.title, page.css));
        }

        const dots = new Adw.CarouselIndicatorDots({ carousel: this._carousel });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            widthRequest: 480,
            heightRequest: 340,
        });
        box.append(this._carousel);
        box.append(dots);

        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._carousel) return;
        this._carousel.allowScrollWheel = this.args.allowScrollWheel as boolean;
        this._carousel.allowLongSwipes = this.args.allowLongSwipes as boolean;
    }
}

GObject.type_ensure(CarouselDotsStory.$gtype);

/** Story: Adw.Carousel with line indicators. */
export class CarouselLinesStory extends StoryWidget {
    private _carousel: Adw.Carousel | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookCarouselLines' }, CarouselLinesStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(CarouselLinesStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...carouselLinesMeta, component: Adw.Carousel.$gtype };
    }

    initialize(): void {
        this._carousel = new Adw.Carousel({
            allowScrollWheel: this.args.allowScrollWheel as boolean,
            allowLongSwipes: this.args.allowLongSwipes as boolean,
            vexpand: true,
        });
        for (const page of PAGES) {
            this._carousel.append(buildPage(page.title, page.css));
        }

        const lines = new Adw.CarouselIndicatorLines({ carousel: this._carousel });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            widthRequest: 480,
            heightRequest: 340,
        });
        box.append(this._carousel);
        box.append(lines);

        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._carousel) return;
        this._carousel.allowScrollWheel = this.args.allowScrollWheel as boolean;
        this._carousel.allowLongSwipes = this.args.allowLongSwipes as boolean;
    }
}

GObject.type_ensure(CarouselLinesStory.$gtype);

export const CarouselStories: StoryModule = { stories: [CarouselDotsStory, CarouselLinesStory] };
