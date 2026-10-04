// Browser port of the Bin story. Shares metadata with bin.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import type { Adw } from '@gjsify/adwaita-web';
import { binMeta } from '../../layout/bin.meta.js';

export class BinWebStory extends StoryElement {
    private _bin: Adw.Bin | null = null;

    constructor() {
        super(BinWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return binMeta;
    }

    initialize(): void {
        this._bin = document.createElement('adw-bin') as Adw.Bin;
        this._bin.style.width = '320px';
        this._apply();
        this.addContent(this._bin);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bin) return;
        const swap = this.args.swap as boolean;
        const card = document.createElement('adw-card');
        card.style.padding = '18px';
        card.style.boxSizing = 'border-box';
        card.textContent = swap ? 'The first child was replaced, not stacked.' : (this.args.label as string);
        // `child` is `adw_bin_set_child`: the old child leaves.
        this._bin.child = card;
    }
}

export const BinWebStories: WebStoryModule = { stories: [BinWebStory] };
