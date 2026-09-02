// NativeScript port of the Navigation Split View story. Shares metadata with the
// GTK navigation-split-view.story.ts and browser navigation-split-view.web.ts
// (imported from the GTK showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import {
    AdwActionRow,
    AdwHeaderBar,
    AdwNavigationSplitView,
    AdwPreferencesGroup,
    AdwStatusPage,
    AdwToolbarView,
} from '@gjsify/adwaita-nativescript';
import type { View } from '@nativescript/core';
import { mailUnreadSymbolic } from '@gjsify/adwaita-icons/status';
import { navigationSplitViewMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class NavigationSplitViewNsStory extends StoryView {
    private _view: AdwNavigationSplitView | null = null;

    constructor() {
        super(NavigationSplitViewNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return navigationSplitViewMeta;
    }

    /** A boxed-list of mailboxes inside a toolbar view — the sidebar page. */
    private buildSidebar(): View {
        const group = new AdwPreferencesGroup();
        for (const [title, subtitle] of [
            ['All Mail', '128 messages', 'mail-unread-symbolic'],
            ['Starred', '6 messages', 'starred-symbolic'],
            ['Drafts', '2 messages', 'document-edit-symbolic'],
            ['Archive', '512 messages', 'folder-symbolic'],
        ] as const) {
            const row = new AdwActionRow();
            row.title = title;
            row.subtitle = subtitle;
            group.addRow(row);
        }

        const header = new AdwHeaderBar();
        header.title = 'Mailboxes';

        const toolbarView = new AdwToolbarView();
        toolbarView.addTopBar(header);
        toolbarView.setContent(group);
        return toolbarView;
    }

    /** A status page inside a toolbar view — the content page. */
    private buildContent(): View {
        const status = new AdwStatusPage();
        status.iconName = mailUnreadSymbolic;
        status.title = 'All Mail';
        status.description = 'Select a conversation from the list to read it here.';

        const header = new AdwHeaderBar();
        header.title = 'All Mail';

        const toolbarView = new AdwToolbarView();
        toolbarView.addTopBar(header);
        toolbarView.setContent(status);
        return toolbarView;
    }

    initialize(): void {
        this._view = new AdwNavigationSplitView();
        this._view.width = 480;
        this._view.height = 340;
        this._view.setSidebar(this.buildSidebar());
        this._view.setContent(this.buildContent());

        this._sync();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._view) return;
        this._view.collapsed = this.args.collapsed as boolean;
        // GTK's `showContent` is the inverse of the NS base's `showSidebar`: when
        // the content is shown (collapsed mode), the sidebar is hidden.
        this._view.showSidebar = !(this.args.showContent as boolean);
    }
}

export const NavigationSplitViewNsStories: NsStoryModule = { stories: [NavigationSplitViewNsStory] };
