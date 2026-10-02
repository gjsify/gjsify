// Browser port of the Progress Bar story. Shares metadata with progress-bar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { progressBarMeta } from '../../controls/progress-bar.meta.js';

export class ProgressBarWebStory extends StoryElement {
    private _bar: HTMLElement | null = null;

    constructor() {
        super(ProgressBarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return progressBarMeta;
    }

    initialize(): void {
        this._bar = document.createElement('gtk-progress-bar');
        this._apply();
        this.addContent(this._bar);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        // GTK's own order: `set_fraction` leaves activity mode and `pulse()` enters it, so
        // `pulsing` is what decides (gtkprogressbar.c:791, :845).
        this._bar.toggleAttribute('pulsing', this.args.pulsing as boolean);
        this._bar.setAttribute('fraction', String(this.args.fraction as number));
        this._bar.toggleAttribute('show-text', this.args.showText as boolean);
        this._bar.toggleAttribute('inverted', this.args.inverted as boolean);
        this._bar.toggleAttribute('osd', this.args.osd as boolean);
    }
}

export const ProgressBarWebStories: WebStoryModule = { stories: [ProgressBarWebStory] };
