// NativeScript port of the View Switcher story. Shares metadata with the GTK
// view-switcher.story.ts and browser view-switcher.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw, type AdwViewPage } from '@gjsify/adwaita-nativescript';
import { folderSymbolic } from '@gjsify/adwaita-icons/places';
import { mailUnreadSymbolic, starredSymbolic } from '@gjsify/adwaita-icons/status';
import { viewSwitcherMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The three pages, mirroring the native demo (Inbox / Starred / Archive).
// `icon` is a REAL Adwaita symbolic SVG string (rendered large by Adw.StatusPage).
const PAGES: ReadonlyArray<{ title: string; icon: string; description: string }> = [
    { title: 'Inbox', icon: mailUnreadSymbolic, description: 'You have three unread conversations.' },
    { title: 'Starred', icon: starredSymbolic, description: 'Messages you have marked as important.' },
    { title: 'Archive', icon: folderSymbolic, description: 'Older conversations kept for reference.' },
];

export class ViewSwitcherNsStory extends StoryView {
    private _switcher: Adw.ViewSwitcher | null = null;

    constructor() {
        super(ViewSwitcherNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return viewSwitcherMeta;
    }

    initialize(): void {
        const switcher = new Adw.ViewSwitcher();
        // Pass the symbolic icon to the switcher button too (icon + label), matching
        // the native Adw.ViewSwitcher whose buttons show an icon beside the label.
        switcher.setViews(
            PAGES.map((page): AdwViewPage => ({ title: page.title, icon: page.icon, content: this._buildPage(page) })),
        );
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

    private _buildPage(page: { title: string; icon: string; description: string }): Adw.StatusPage {
        const status = new Adw.StatusPage();
        status.iconName = page.icon;
        status.title = page.title;
        status.description = page.description;
        return status;
    }
}

export const ViewSwitcherNsStories: NsStoryModule = { stories: [ViewSwitcherNsStory] };
