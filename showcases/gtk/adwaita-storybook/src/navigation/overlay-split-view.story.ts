// Adw.OverlaySplitView — a sidebar that sits beside the content, or overlays it
// when collapsed. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { overlaySplitViewMeta } from './overlay-split-view.meta.js';

/** Story: Adw.OverlaySplitView with a boxed-list sidebar and a status-page content. */
export class OverlaySplitViewStory extends StoryWidget {
    private _view: Adw.OverlaySplitView | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookOverlaySplitView' }, OverlaySplitViewStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(OverlaySplitViewStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...overlaySplitViewMeta, component: Adw.OverlaySplitView.$gtype };
    }

    private buildSidebar(): Gtk.Widget {
        const group = new Adw.PreferencesGroup();
        for (const [title, icon] of [
            ['Home', 'go-home-symbolic'],
            ['Discover', 'system-search-symbolic'],
            ['Library', 'folder-music-symbolic'],
            ['Settings', 'emblem-system-symbolic'],
        ] as const) {
            const row = new Adw.ActionRow({ title });
            row.add_prefix(new Gtk.Image({ iconName: icon }));
            row.activatable = true;
            group.add(row);
        }

        const toolbarView = new Adw.ToolbarView();
        toolbarView.add_top_bar(new Adw.HeaderBar({ showTitle: false }));
        toolbarView.content = group;
        toolbarView.add_css_class('sidebar');
        return toolbarView;
    }

    private buildContent(): Gtk.Widget {
        const status = new Adw.StatusPage({
            iconName: 'folder-music-symbolic',
            title: 'Your Library',
            description: 'Toggle the sidebar to browse sections. Collapse it to overlay the content.',
            vexpand: true,
        });

        const toolbarView = new Adw.ToolbarView();
        toolbarView.add_top_bar(new Adw.HeaderBar());
        toolbarView.content = status;
        return toolbarView;
    }

    initialize(): void {
        this._view = new Adw.OverlaySplitView({
            sidebar: this.buildSidebar(),
            content: this.buildContent(),
            showSidebar: this.args.showSidebar as boolean,
            collapsed: this.args.collapsed as boolean,
            widthRequest: 480,
            heightRequest: 340,
        });
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._view) return;
        this._view.showSidebar = this.args.showSidebar as boolean;
        this._view.collapsed = this.args.collapsed as boolean;
    }
}

GObject.type_ensure(OverlaySplitViewStory.$gtype);

export const OverlaySplitViewStories: StoryModule = { stories: [OverlaySplitViewStory] };
