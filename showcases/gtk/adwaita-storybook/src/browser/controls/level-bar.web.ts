// Browser port of the Level Bar story. Shares metadata with level-bar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { levelBarMeta } from '../../controls/level-bar.meta.js';

export class LevelBarWebStory extends StoryElement {
    private _bar: HTMLElement | null = null;

    constructor() {
        super(LevelBarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return levelBarMeta;
    }

    initialize(): void {
        this._bar = document.createElement('gtk-level-bar');
        this._apply();
        this.addContent(this._bar);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        const vertical = this.args.orientation === 'vertical';
        this._bar.setAttribute('orientation', vertical ? 'vertical' : 'horizontal');
        // A horizontal bar fills the width it is given and a vertical one the height; the
        // stylesheet takes the cross-axis from the orientation, so only the axis needs one.
        this._bar.style.width = vertical ? '' : '200px';
        this._bar.style.height = vertical ? '120px' : '';
        // A new `max-value` drags `value` down with it, so it goes first (gtklevelbar.c:1229).
        this._bar.setAttribute('max-value', String(this.args.maxValue as number));
        this._bar.setAttribute('mode', this.args.mode as string);
        this._bar.setAttribute('value', String(this.args.value as number));
        this._bar.toggleAttribute('inverted', this.args.inverted as boolean);
    }
}

export const LevelBarWebStories: WebStoryModule = { stories: [LevelBarWebStory] };
