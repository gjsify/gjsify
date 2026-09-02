// Adw.NavigationSplitView — a two-pane sidebar/content split that collapses
// into a single navigation stack. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { navigationSplitViewMeta } from './navigation-split-view.meta.js';

/** Story: Adw.NavigationSplitView with a boxed-list sidebar and a content page. */
export class NavigationSplitViewStory extends StoryWidget {
    private _view: Adw.NavigationSplitView | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookNavigationSplitView' }, NavigationSplitViewStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(NavigationSplitViewStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...navigationSplitViewMeta, component: Adw.NavigationSplitView.$gtype };
    }

    private buildSidebar(): Adw.NavigationPage {
        const group = new Adw.PreferencesGroup();
        for (const [title, subtitle, icon] of [
            ['All Mail', '128 messages', 'mail-unread-symbolic'],
            ['Starred', '6 messages', 'starred-symbolic'],
            ['Drafts', '2 messages', 'document-edit-symbolic'],
            ['Archive', '512 messages', 'folder-symbolic'],
        ] as const) {
            const row = new Adw.ActionRow({ title, subtitle });
            row.add_prefix(new Gtk.Image({ iconName: icon }));
            row.activatable = true;
            group.add(row);
        }

        const toolbarView = new Adw.ToolbarView();
        toolbarView.add_top_bar(new Adw.HeaderBar());
        toolbarView.content = group;

        return new Adw.NavigationPage({ title: 'Mailboxes', child: toolbarView });
    }

    private buildContent(): Adw.NavigationPage {
        const status = new Adw.StatusPage({
            iconName: 'mail-unread-symbolic',
            title: 'All Mail',
            description: 'Select a conversation from the list to read it here.',
            vexpand: true,
        });

        const toolbarView = new Adw.ToolbarView();
        toolbarView.add_top_bar(new Adw.HeaderBar());
        toolbarView.content = status;

        return new Adw.NavigationPage({ title: 'All Mail', child: toolbarView });
    }

    initialize(): void {
        this._view = new Adw.NavigationSplitView({
            sidebar: this.buildSidebar(),
            content: this.buildContent(),
            showContent: this.args.showContent as boolean,
            collapsed: this.args.collapsed as boolean,
            widthRequest: 480,
            heightRequest: 340,
        });
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._view) return;
        this._view.showContent = this.args.showContent as boolean;
        this._view.collapsed = this.args.collapsed as boolean;
    }
}

GObject.type_ensure(NavigationSplitViewStory.$gtype);

export const NavigationSplitViewStories: StoryModule = { stories: [NavigationSplitViewStory] };
