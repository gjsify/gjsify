// NativeScript port of the Shortcut Label story. Shares metadata with the GTK
// shortcut-label.story.ts and browser shortcut-label.web.ts (imported from the
// GTK showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwShortcutLabel } from '@gjsify/adwaita-nativescript';
import { shortcutLabelMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class ShortcutLabelNsStory extends StoryView {
    private _widget: AdwShortcutLabel | null = null;

    constructor() {
        super(ShortcutLabelNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return shortcutLabelMeta;
    }

    initialize(): void {
        this._widget = new AdwShortcutLabel();
        this._sync();
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    /** `disabledText` first: an empty accelerator renders the placeholder, so the
     *  placeholder has to be in place before the accelerator triggers the rebuild. */
    private _sync(): void {
        if (!this._widget) return;
        this._widget.disabledText = this.args.disabledText as string;
        this._widget.accelerator = this.args.accelerator as string;
    }
}

export const ShortcutLabelNsStories: NsStoryModule = { stories: [ShortcutLabelNsStory] };
