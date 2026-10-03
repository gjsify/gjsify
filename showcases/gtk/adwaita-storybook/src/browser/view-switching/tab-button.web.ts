// Browser port of the Tab Button story. Shares metadata with tab-button.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import type { Adw } from '@gjsify/adwaita-web';
import { tabButtonMeta } from '../../view-switching/tab-button.meta.js';

export class TabButtonWebStory extends StoryElement {
    private _view: Adw.TabView | null = null;
    private _serial = 0;

    constructor() {
        super(TabButtonWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return tabButtonMeta;
    }

    initialize(): void {
        // The view is the counter's data source and is never shown.
        this._view = document.createElement('adw-tab-view') as Adw.TabView;
        this._view.hidden = true;
        const button = document.createElement('adw-tab-button') as Adw.TabButton;
        const stage = document.createElement('div');
        stage.append(this._view, button);
        this.addContent(stage);
        button.view = this._view;
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const view = this._view;
        if (!view) return;
        const wanted = this.args.pages as number;
        // Pages added after the view connected go through its API.
        while (view.nPages < wanted) {
            this._serial += 1;
            view.appendPage({ id: `page-${this._serial}`, title: `Page ${view.nPages}` });
        }
        while (view.nPages > wanted) view.closePage(view.pages[view.nPages - 1].id);
        const last = view.nPages - 1;
        view.pages.forEach((page, i) => {
            view.setPageNeedsAttention(page.id, (this.args.needsAttention as boolean) && i === last);
        });
    }
}

export const TabButtonWebStories: WebStoryModule = { stories: [TabButtonWebStory] };
