// NativeScript port of the Status Page story. Shares metadata with the GTK
// status-page.story.ts and browser status-page.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwButton, AdwStatusPage } from '@gjsify/adwaita-nativescript';
import { statusPageMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// AdwStatusPage (NS) shows `iconText` as a large glyph Label — the CSS subset
// has no icon-theme lookup, so the symbolic icon names from the shared metadata
// map to the closest emoji glyph (a documented fidelity compromise, mirroring
// the widget's own `iconText` contract).
const ICON_GLYPHS: Record<string, string> = {
    'folder-symbolic': '📁',
    'mail-unread-symbolic': '✉️',
    'system-search-symbolic': '🔍',
    'starred-symbolic': '⭐',
};

export class StatusPageNsStory extends StoryView {
    private _page: AdwStatusPage | null = null;

    constructor() {
        super(StatusPageNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return statusPageMeta;
    }

    initialize(): void {
        this._page = new AdwStatusPage();

        // Suggested-action pill button, matching the native story's child.
        const button = new AdwButton();
        button.text = 'New Document';
        button.variant = 'suggested-action';
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
        this._page.iconText = ICON_GLYPHS[iconName] ?? '📄';
        this._page.title = this.args.title as string;
        this._page.description = this.args.description as string;
    }
}

export const StatusPageNsStories: NsStoryModule = { stories: [StatusPageNsStory] };
