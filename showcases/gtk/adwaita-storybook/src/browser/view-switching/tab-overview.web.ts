// Browser port of the Tab Overview story — an <adw-tab-overview> over an
// <adw-tab-view> with three pages, one of them pinned, plus the open / search /
// new-tab / inverted controls. Shares its metadata with tab-overview.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import type { Adw } from '@gjsify/adwaita-web';
import { tabOverviewMeta } from '../../view-switching/tab-overview.meta.js';

const TABS: ReadonlyArray<{ title: string; body: string }> = [
    { title: 'Overview', body: 'A summary of everything at a glance.' },
    { title: 'Details', body: 'The specifics, broken down line by line.' },
    { title: 'History', body: 'A log of every change made so far.' },
];

export class TabOverviewWebStory extends StoryElement {
    private _overview: Adw.TabOverview | null = null;
    private _view: Adw.TabView | null = null;

    constructor() {
        super(TabOverviewWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return tabOverviewMeta;
    }

    initialize(): void {
        const view = document.createElement('adw-tab-view') as Adw.TabView;
        view.style.width = '480px';
        view.style.height = '340px';

        for (const [index, tab] of TABS.entries()) {
            const page = document.createElement('adw-tab-page');
            page.setAttribute('title', tab.title);
            if (index === 0) page.setAttribute('pinned', '');
            page.appendChild(this._buildPageBody(tab.title, tab.body));
            view.appendChild(page);
        }
        this._view = view;

        const overview = document.createElement('adw-tab-overview') as Adw.TabOverview;
        overview.style.width = '480px';
        overview.style.height = '340px';
        overview.appendChild(view);

        // `create-tab`'s handler returns the page; in the DOM that is `detail.page`.
        overview.addEventListener('create-tab', (event) => {
            // A declared `<adw-tab-page>` is adopted on connect only, so the new page
            // goes in through the view's API — the rule the tab-button story follows.
            // `appendPage` returns the POSITION, so the page itself is read back off the
            // view: `create-tab`'s handler must hand over the page, not a number.
            const position = view.appendPage({
                id: `new-${view.nPages}`,
                title: 'New Page',
                content: this._buildPageBody('New Page', 'Just created.'),
            });
            (event as CustomEvent).detail.page = view.pages[position];
        });

        this._overview = overview;
        this.addContent(overview);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _buildPageBody(title: string, body: string): HTMLElement {
        const status = document.createElement('adw-status-page');
        status.setAttribute('icon', 'view-paged');
        status.setAttribute('title', title);
        if (body !== '') status.setAttribute('description', body);
        return status;
    }

    private _apply(): void {
        const overview = this._overview;
        if (overview === null) return;
        overview.enableSearch = this.args.enableSearch as boolean;
        overview.enableNewTab = this.args.enableNewTab as boolean;
        overview.inverted = this.args.inverted as boolean;
        overview.setOpen(this.args.open as boolean);
    }
}

export const TabOverviewWebStories: WebStoryModule = { stories: [TabOverviewWebStory] };
