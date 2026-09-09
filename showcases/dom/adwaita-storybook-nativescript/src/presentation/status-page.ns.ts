// NativeScript port of the Status Page story. Shares metadata with the GTK
// status-page.story.ts and browser status-page.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

// The story's `iconName` control offers THEME NAMES, and since `icon-theme.ts` the port
// resolves one — so the local name-to-SVG map that used to sit here is gone. Seven of
// these existed across this showcase, each re-implementing the `-symbolic` strip and a
// switch over three or four names, each with its own fallback.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { statusPageMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class StatusPageNsStory extends StoryView {
    private _page: Adw.StatusPage | null = null;

    constructor() {
        super(StatusPageNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return statusPageMeta;
    }

    initialize(): void {
        this._page = new Adw.StatusPage();

        // Suggested-action pill button, matching the native story's child.
        const button = new Gtk.Button();
        button.text = 'New Document';
        button.styleClasses = 'suggested-action';
        this._page.set_child(button);

        this._sync();
        this.addContent(this._page);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._page) return;
        const iconName = this.args.iconName as string;
        this._page.iconName = iconName;
        this._page.title = this.args.title as string;
        this._page.description = this.args.description as string;
    }
}

export const StatusPageNsStories: NsStoryModule = { stories: [StatusPageNsStory] };
