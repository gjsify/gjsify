// Browser port of the Banner story. Shares metadata with banner.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { bannerMeta } from '../../presentation/banner.meta.js';

export class BannerWebStory extends StoryElement {
    private _banner: HTMLElement | null = null;

    constructor() {
        super(BannerWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return bannerMeta;
    }

    initialize(): void {
        this._banner = document.createElement('adw-banner');
        this._sync();

        // The native story shows the banner full-width inside a sized container.
        const container = document.createElement('div');
        container.style.cssText = 'width:460px;max-width:100%;';
        container.append(this._banner);
        this.addContent(container);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._banner) return;
        this._banner.setAttribute('title', this.args.title as string);
        this._banner.setAttribute('button-label', this.args.buttonLabel as string);
        this._banner.toggleAttribute('revealed', this.args.revealed as boolean);
        this._banner.toggleAttribute('use-markup', this.args.useMarkup as boolean);
    }
}

export const BannerWebStories: WebStoryModule = { stories: [BannerWebStory] };
