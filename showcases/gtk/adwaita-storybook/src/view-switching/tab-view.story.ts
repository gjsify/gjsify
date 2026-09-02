// Adw.TabView — a tabbed container with an Adw.TabBar header. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { tabViewMeta } from './tab-view.meta.js';

const TABS: ReadonlyArray<{ title: string; body: string }> = [
    { title: 'Overview', body: 'A summary of everything at a glance.' },
    { title: 'Details', body: 'The specifics, broken down line by line.' },
    { title: 'History', body: 'A log of every change made so far.' },
];

/** Story: Adw.TabView with an Adw.TabBar and three appended pages. */
export class TabViewStory extends StoryWidget {
    private _tabBar: Adw.TabBar | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookTabView' }, TabViewStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(TabViewStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...tabViewMeta, component: Adw.TabView.$gtype };
    }

    private buildPageBody(title: string, body: string): Gtk.Widget {
        const status = new Adw.StatusPage({
            iconName: 'view-paged-symbolic',
            title,
            description: body,
            vexpand: true,
        });
        return status;
    }

    initialize(): void {
        const tabView = new Adw.TabView({ vexpand: true });
        for (const tab of TABS) {
            const page = tabView.append(this.buildPageBody(tab.title, tab.body));
            page.title = tab.title;
        }

        this._tabBar = new Adw.TabBar({
            view: tabView,
            autohide: this.args.autohide as boolean,
        });

        const box = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            widthRequest: 480,
            heightRequest: 340,
        });
        box.append(this._tabBar);
        box.append(tabView);

        this.addContent(box);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._tabBar) return;
        this._tabBar.autohide = this.args.autohide as boolean;
    }
}

GObject.type_ensure(TabViewStory.$gtype);

export const TabViewStories: StoryModule = { stories: [TabViewStory] };
