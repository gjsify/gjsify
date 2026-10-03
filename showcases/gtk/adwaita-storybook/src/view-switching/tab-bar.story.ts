// Adw.TabBar — the tab bar as its own widget, bound to an Adw.TabView through `view`, with
// a start and an end action widget beside the chips. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { tabBarMeta } from './tab-bar.meta.js';

const TABS: ReadonlyArray<{ title: string; body: string }> = [
    { title: 'Overview', body: 'A summary of everything at a glance.' },
    { title: 'Details', body: 'The specifics, broken down line by line.' },
    { title: 'History', body: 'A log of every change made so far.' },
];

/** Story: an AdwTabBar over an AdwTabView, with the bar's five properties on controls. */
export class TabBarStory extends StoryWidget {
    private _bar: Adw.TabBar | null = null;
    private _startAction: Gtk.Button | null = null;
    private _endAction: Gtk.Button | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookTabBar' }, TabBarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(TabBarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...tabBarMeta, component: Adw.TabBar.$gtype };
    }

    initialize(): void {
        const view = new Adw.TabView({ vexpand: true });
        for (const tab of TABS) {
            const page = view.append(
                new Adw.StatusPage({ iconName: 'view-paged-symbolic', title: tab.title, description: tab.body }),
            );
            page.title = tab.title;
        }

        // The two action widgets are `GtkWidget`-typed PROPERTIES, so they are widgets of the
        // caller's rather than children: `AdwTabBar` puts each in an `AdwBin` beside the box.
        this._startAction = new Gtk.Button({
            iconName: 'list-add-symbolic',
            tooltipText: 'New page',
            cssClasses: ['flat'],
        });
        this._endAction = new Gtk.Button({
            iconName: 'view-more-symbolic',
            tooltipText: 'Menu',
            cssClasses: ['flat'],
        });

        const bar = new Adw.TabBar({ view });
        this._bar = bar;

        const root = new Gtk.Box({ orientation: Gtk.Orientation.VERTICAL, widthRequest: 480, heightRequest: 320 });
        root.append(bar);
        root.append(view);
        this.addContent(root);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const bar = this._bar;
        if (bar === null) return;
        bar.autohide = this.args.autohide as boolean;
        bar.expandTabs = this.args.expandTabs as boolean;
        bar.inverted = this.args.inverted as boolean;
        // `null` is how C removes an action widget, and it is what the element's own
        // `startActionWidget = null` mirrors.
        bar.startActionWidget = (this.args.startAction as boolean) ? this._startAction : null;
        bar.endActionWidget = (this.args.endAction as boolean) ? this._endAction : null;
    }
}

GObject.type_ensure(TabBarStory.$gtype);

export const TabBarStories: StoryModule = { stories: [TabBarStory] };
