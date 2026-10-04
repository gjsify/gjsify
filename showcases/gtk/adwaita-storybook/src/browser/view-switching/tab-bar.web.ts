// Browser port of the Tab Bar story — an <adw-tab-bar> bound by id to an
// <adw-tab-view>, with a slotted action widget on each side and the bar's five properties
// on the same controls. Shares its metadata with tab-bar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import type { Adw } from '@gjsify/adwaita-web';
import { tabBarMeta } from '../../view-switching/tab-bar.meta.js';

const TABS: ReadonlyArray<{ title: string; body: string }> = [
    { title: 'Overview', body: 'A summary of everything at a glance.' },
    { title: 'Details', body: 'The specifics, broken down line by line.' },
    { title: 'History', body: 'A log of every change made so far.' },
];

export class TabBarWebStory extends StoryElement {
    private _bar: Adw.TabBar | null = null;
    private _view: Adw.TabView | null = null;
    private _startAction: HTMLButtonElement | null = null;
    private _endAction: HTMLButtonElement | null = null;

    constructor() {
        super(TabBarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return tabBarMeta;
    }

    initialize(): void {
        const view = document.createElement('adw-tab-view') as Adw.TabView;
        view.style.flex = '1';
        for (const tab of TABS) {
            const page = document.createElement('adw-tab-page');
            page.setAttribute('title', tab.title);
            page.appendChild(this._buildPageBody(tab.title, tab.body));
            view.appendChild(page);
        }
        this._view = view;

        const bar = document.createElement('adw-tab-bar') as Adw.TabBar;
        // `view` is a widget REFERENCE upstream, and an id reference here — the same
        // divergence `<adw-tab-button>` and `<adw-view-switcher-bar>` make. The setter
        // takes the element directly, which is what `_apply` below uses for the rebinds.
        bar.setAttribute('view', 'tab-bar-story-view');
        view.id = 'tab-bar-story-view';
        this._bar = bar;

        // The two action widgets are widget-typed PROPERTIES, so a document spells them as
        // `slot=` children rather than as children of their own.
        this._startAction = this._actionButton('list-add-symbolic', 'New page');
        this._startAction.slot = 'start-action-widget';
        bar.appendChild(this._startAction);

        this._endAction = this._actionButton('view-more-symbolic', 'Menu');
        this._endAction.slot = 'end-action-widget';
        bar.appendChild(this._endAction);

        const root = document.createElement('div');
        root.style.display = 'flex';
        root.style.flexDirection = 'column';
        root.style.width = '480px';
        root.style.height = '320px';
        root.append(bar, view);
        this.addContent(root);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _actionButton(icon: string, tooltip: string): HTMLButtonElement {
        const button = document.createElement('button') as HTMLButtonElement;
        button.type = 'button';
        button.className = 'adw-button flat image-button';
        button.title = tooltip;
        const image = document.createElement('gtk-image');
        image.setAttribute('icon', icon);
        button.appendChild(image);
        return button;
    }

    private _buildPageBody(title: string, body: string): HTMLElement {
        const status = document.createElement('adw-status-page');
        status.setAttribute('icon', 'view-paged');
        status.setAttribute('title', title);
        status.setAttribute('description', body);
        return status;
    }

    private _apply(): void {
        const bar = this._bar;
        const view = this._view;
        if (bar === null || view === null) return;
        bar.autohide = this.args.autohide as boolean;
        bar.expandTabs = this.args.expandTabs as boolean;
        bar.inverted = this.args.inverted as boolean;
        // `view` through the PROPERTY, so the rebind does not depend on the id staying put.
        if (bar.view !== view) bar.view = view;
        bar.startActionWidget = (this.args.startAction as boolean) ? this._startAction : null;
        bar.endActionWidget = (this.args.endAction as boolean) ? this._endAction : null;
    }
}

export const TabBarWebStories: WebStoryModule = { stories: [TabBarWebStory] };
