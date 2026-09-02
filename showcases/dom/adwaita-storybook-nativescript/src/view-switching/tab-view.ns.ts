// NativeScript port of the Tab View story. Shares metadata with the GTK
// tab-view.story.ts and browser tab-view.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { AdwTabView, AdwStatusPage, type AdwViewPage } from '@gjsify/adwaita-nativescript';
import { viewGridSymbolic } from '@gjsify/adwaita-icons/actions';
import { tabViewMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

const TABS: ReadonlyArray<{ title: string; body: string }> = [
    { title: 'Overview', body: 'A summary of everything at a glance.' },
    { title: 'Details', body: 'The specifics, broken down line by line.' },
    { title: 'History', body: 'A log of every change made so far.' },
];

export class TabViewNsStory extends StoryView {
    private _tabView: AdwTabView | null = null;

    constructor() {
        super(TabViewNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return tabViewMeta;
    }

    initialize(): void {
        const tabView = new AdwTabView();
        tabView.setViews(TABS.map((tab): AdwViewPage => ({ title: tab.title, content: this._buildPageBody(tab) })));
        this._tabView = tabView;
        tabView.autohide = this.args.autohide as boolean;
        this.addContent(tabView);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._tabView) return;
        this._tabView.autohide = this.args.autohide as boolean;
    }

    // `▦` glyph stands in for the native `view-paged-symbolic` — the NS subset has
    // no icon-theme lookup, so AdwStatusPage takes a glyph.
    private _buildPageBody(tab: { title: string; body: string }): AdwStatusPage {
        const status = new AdwStatusPage();
        status.iconName = viewGridSymbolic;
        status.title = tab.title;
        status.description = tab.body;
        return status;
    }
}

export const TabViewNsStories: NsStoryModule = { stories: [TabViewNsStory] };
