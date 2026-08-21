// NativeScript port of the Banner story. Shares metadata with the GTK
// banner.story.ts and browser banner.web.ts (imported from the GTK showcase's
// renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwBanner } from '@gjsify/adwaita-nativescript';
import { bannerMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class BannerNsStory extends StoryView {
    private _banner: AdwBanner | null = null;

    constructor() {
        super(BannerNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return bannerMeta;
    }

    initialize(): void {
        this._banner = new AdwBanner();
        this._sync();
        this.addContent(this._banner);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._banner) return;
        this._banner.title = this.args.title as string;
        this._banner.buttonLabel = this.args.buttonLabel as string;
        this._banner.revealed = this.args.revealed as boolean;
        // The NS banner label is plain text — the CSS subset has no markup or
        // rich-text rendering — so `useMarkup` has nothing to switch. Read it so the
        // control stays bound to this rendering too.
        void (this.args.useMarkup as boolean);
    }
}

export const BannerNsStories: NsStoryModule = { stories: [BannerNsStory] };
