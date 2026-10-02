// Adw.TabOverview — a grid of tab thumbnails over an Adw.TabView. original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { tabOverviewMeta } from './tab-overview.meta.js';

const TABS: ReadonlyArray<{ title: string; body: string }> = [
    { title: 'Overview', body: 'A summary of everything at a glance.' },
    { title: 'Details', body: 'The specifics, broken down line by line.' },
    { title: 'History', body: 'A log of every change made so far.' },
];

/** Story: Adw.TabOverview over an Adw.TabView with three pages, one of them pinned. */
export class TabOverviewStory extends StoryWidget {
    private _overview: Adw.TabOverview | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookTabOverview' }, TabOverviewStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(TabOverviewStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...tabOverviewMeta, component: Adw.TabOverview.$gtype };
    }

    initialize(): void {
        const view = new Adw.TabView({ vexpand: true });
        for (const [index, tab] of TABS.entries()) {
            const status = new Adw.StatusPage({
                iconName: 'view-paged-symbolic',
                title: tab.title,
                description: tab.body,
                vexpand: true,
            });
            const page = view.append(status);
            page.title = tab.title;
            // One PINNED page, so the overview has a pinned grid above the ordinary
            // one — the two-grid arrangement `AdwTabOverview` builds its template with.
            if (index === 0) page.pinned = true;
        }

        const overview = new Adw.TabOverview({
            view,
            child: view,
            widthRequest: 480,
            heightRequest: 340,
        });
        this._overview = overview;

        // Without a `create-tab` handler the new-tab button cannot work: C warns
        // ("AdwTabOverview::create-tab handler must not return NULL") when one is
        // missing, so the story connects one and the button is usable.
        overview.connect('create-tab', () => {
            const page = view.append(
                new Adw.StatusPage({ iconName: 'view-paged-symbolic', title: 'New Page', vexpand: true }),
            );
            page.title = 'New Page';
            return page;
        });

        this.addContent(overview);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const overview = this._overview;
        if (!overview) return;
        overview.enableSearch = this.args.enableSearch as boolean;
        overview.enableNewTab = this.args.enableNewTab as boolean;
        overview.inverted = this.args.inverted as boolean;
        overview.open = this.args.open as boolean;
    }
}

GObject.type_ensure(TabOverviewStory.$gtype);

export const TabOverviewStories: StoryModule = { stories: [TabOverviewStory] };
