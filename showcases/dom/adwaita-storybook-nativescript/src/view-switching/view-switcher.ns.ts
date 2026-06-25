// NativeScript port of the View Switcher story. Shares metadata with the GTK
// view-switcher.story.ts and browser view-switcher.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwViewSwitcher, AdwStatusPage, type AdwViewPage } from '@gjsify/adwaita-nativescript';
import { viewSwitcherMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The three pages, mirroring the native demo (Inbox / Starred / Archive).
// `icon` is a glyph (AdwStatusPage has no icon-theme lookup in the CSS subset).
const PAGES: ReadonlyArray<{ title: string; icon: string; description: string }> = [
    { title: 'Inbox', icon: '✉', description: 'You have three unread conversations.' },
    { title: 'Starred', icon: '★', description: 'Messages you have marked as important.' },
    { title: 'Archive', icon: '🗀', description: 'Older conversations kept for reference.' },
];

export class ViewSwitcherNsStory extends StoryView {
    private _switcher: AdwViewSwitcher | null = null;

    constructor() {
        super(ViewSwitcherNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return viewSwitcherMeta;
    }

    initialize(): void {
        const switcher = new AdwViewSwitcher();
        switcher.setViews(PAGES.map((page): AdwViewPage => ({ title: page.title, content: this._buildPage(page) })));
        this._switcher = switcher;
        // policy (wide / narrow) has no NS equivalent — the switcher is always the
        // centered pill bar (see fidelity note). Read it to keep the control bound.
        void (this.args.policy as string);
        this.addContent(switcher);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._switcher) return;
        void (this.args.policy as string);
    }

    private _buildPage(page: { title: string; icon: string; description: string }): AdwStatusPage {
        const status = new AdwStatusPage();
        status.iconText = page.icon;
        status.title = page.title;
        status.description = page.description;
        return status;
    }
}

export const ViewSwitcherNsStories: NsStoryModule = { stories: [ViewSwitcherNsStory] };
