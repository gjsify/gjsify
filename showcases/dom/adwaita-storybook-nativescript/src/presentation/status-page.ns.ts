// NativeScript port of the Status Page story. Shares metadata with the GTK
// status-page.story.ts and browser status-page.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, Gtk } from '@gjsify/adwaita-nativescript';
import { systemSearchSymbolic } from '@gjsify/adwaita-icons/actions';
import { folderSymbolic } from '@gjsify/adwaita-icons/places';
import { mailUnreadSymbolic, starredSymbolic } from '@gjsify/adwaita-icons/status';
import { statusPageMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// Adw.StatusPage (NS) renders a REAL large Adwaita symbolic icon, so the shared
// metadata's symbolic names map to the actual SVG strings — matching native.
const ICON_SVGS: Record<string, string> = {
    'folder-symbolic': folderSymbolic,
    'mail-unread-symbolic': mailUnreadSymbolic,
    'system-search-symbolic': systemSearchSymbolic,
    'starred-symbolic': starredSymbolic,
};

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
        this._page.setChild(button);

        this._sync();
        this.addContent(this._page);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._page) return;
        const iconName = this.args.iconName as string;
        this._page.iconName = ICON_SVGS[iconName] ?? folderSymbolic;
        this._page.title = this.args.title as string;
        this._page.description = this.args.description as string;
    }
}

export const StatusPageNsStories: NsStoryModule = { stories: [StatusPageNsStory] };
