// Browser port of the Tab View story — an adw-tab-view with three adw-tab-page
// children, each holding an adw-status-page body, plus the autohide control.
// Shares its metadata/controls with the GTK twin (tab-view.story.ts).

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { tabViewMeta } from '../../view-switching/tab-view.meta.js';

const TABS: ReadonlyArray<{ title: string; body: string }> = [
    { title: 'Overview', body: 'A summary of everything at a glance.' },
    { title: 'Details', body: 'The specifics, broken down line by line.' },
    { title: 'History', body: 'A log of every change made so far.' },
];

export class TabViewWebStory extends StoryElement {
    private _tabView: HTMLElement | null = null;

    constructor() {
        super(TabViewWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return tabViewMeta;
    }

    initialize(): void {
        const tabView = document.createElement('adw-tab-view');
        tabView.style.width = '480px';
        tabView.style.height = '340px';

        for (const tab of TABS) {
            const page = document.createElement('adw-tab-page');
            page.setAttribute('title', tab.title);
            page.appendChild(this._buildPageBody(tab.title, tab.body));
            tabView.appendChild(page);
        }

        this._tabView = tabView;
        this._applyAutohide(this.args.autohide as boolean);
        this.addContent(tabView);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._tabView) return;
        this._applyAutohide(this.args.autohide as boolean);
    }

    // The SAME name the GTK twin uses. It stood in as `view-grid` under a comment
    // blaming @gjsify/adwaita-icons for not having the glyph — which exports it at
    // actions.ts:981; what was missing was a `.adw-icon--view-paged` mask class, so
    // the right name drew a solid square and a different glyph was substituted.
    // `scripts/check-adwaita-icon-masks.mjs` now fails that state instead.
    private _buildPageBody(title: string, body: string): HTMLElement {
        const status = document.createElement('adw-status-page');
        status.setAttribute('icon', 'view-paged');
        status.setAttribute('title', title);
        status.setAttribute('description', body);
        return status;
    }

    private _applyAutohide(autohide: boolean): void {
        if (!this._tabView) return;
        if (autohide) this._tabView.setAttribute('autohide', '');
        else this._tabView.removeAttribute('autohide');
    }
}

export const TabViewWebStories: WebStoryModule = { stories: [TabViewWebStory] };
