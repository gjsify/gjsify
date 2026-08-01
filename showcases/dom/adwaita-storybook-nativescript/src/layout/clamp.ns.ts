// NativeScript port of the Clamp story. Shares metadata with the GTK
// clamp.story.ts and browser clamp.web.ts (imported from the GTK showcase's
// renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwButtonContent, AdwClamp } from '@gjsify/adwaita-nativescript';
import { clampMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class ClampNsStory extends StoryView {
    private _clamp: AdwClamp | null = null;

    constructor() {
        super(ClampNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return clampMeta;
    }

    initialize(): void {
        // A boxed card fills the clamp, which caps its width at maximum-size and
        // centres it — the NS analogue of the browser twin's <adw-card>. The NS
        // CSS subset has no real card widget here, so a labelled AdwButtonContent
        // carries the clamped text (closest Adwaita primitive for centred text).
        const inner = new AdwButtonContent();
        inner.className = `${inner.className} card`.trim();
        inner.label = 'This content is clamped — it stops growing past the maximum size and stays centred.';

        this._clamp = new AdwClamp();
        this._clamp.setChild(inner);
        this._syncClamp();

        this.addContent(this._clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncClamp();
    }

    private _syncClamp(): void {
        if (!this._clamp) return;
        this._clamp.maximumSize = this.args.maximumSize as number;
    }
}

export const ClampNsStories: NsStoryModule = { stories: [ClampNsStory] };
