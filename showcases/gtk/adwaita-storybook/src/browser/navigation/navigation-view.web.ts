// Browser port of the Navigation View story. Shares metadata with
// navigation-view.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { navigationViewMeta } from '../../navigation/navigation-view.meta.js';

interface AdwNavigationViewEl extends HTMLElement {
    push(pageOrTag: HTMLElement | string): void;
}

export class NavigationViewWebStory extends StoryElement {
    private _view: AdwNavigationViewEl | null = null;
    private _rootTitle: HTMLElement | null = null;
    private _detailPage: HTMLElement | null = null;
    private _detailTitle: HTMLElement | null = null;
    private _detailStatus: HTMLElement | null = null;

    constructor() {
        super(NavigationViewWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return navigationViewMeta;
    }

    initialize(): void {
        this._view = document.createElement('adw-navigation-view') as AdwNavigationViewEl;
        this._view.style.width = '480px';
        this._view.style.height = '340px';
        this._view.setAttribute('animate-transitions', (this.args.animateTransitions as boolean) ? 'true' : 'false');

        // --- Detail page: a status page describing the contact. ---
        this._detailTitle = document.createElement('adw-window-title');
        this._detailTitle.setAttribute('title', this.args.detailTitle as string);
        this._detailTitle.setAttribute('slot', 'center');

        this._detailStatus = document.createElement('adw-status-page');
        this._detailStatus.setAttribute('icon', 'avatar-default');
        this._detailStatus.setAttribute('title', this.args.detailTitle as string);
        this._detailStatus.setAttribute('description', 'Mathematician and writer, the first computer programmer.');

        const detailHeader = document.createElement('adw-header-bar');
        detailHeader.setAttribute('slot', 'top');
        detailHeader.appendChild(this._detailTitle);

        const detailToolbar = document.createElement('adw-toolbar-view');
        detailToolbar.append(detailHeader, this._detailStatus);

        this._detailPage = document.createElement('adw-navigation-page');
        this._detailPage.setAttribute('tag', 'detail');
        this._detailPage.setAttribute('title', this.args.detailTitle as string);
        this._detailPage.appendChild(detailToolbar);

        // --- Root page: an "Open contact" pill button that pushes the detail. ---
        this._rootTitle = document.createElement('adw-window-title');
        this._rootTitle.setAttribute('title', this.args.rootTitle as string);
        this._rootTitle.setAttribute('slot', 'center');

        const openButton = document.createElement('gtk-button');
        openButton.setAttribute('label', 'Open contact');
        openButton.setAttribute('pill', '');
        openButton.setAttribute('suggested', '');
        openButton.addEventListener('click', () => {
            this._view?.push('detail');
        });

        // The GJS story builds this button with `halign: CENTER, valign: CENTER`,
        // because Adw.ToolbarView hands its content widget the whole rect and a
        // widget that wants less says so through its alignment. This is that
        // sentence in the web port: a centring box around the button. It used to be
        // a bare `adw-navigation-view-root-action` class, which matched no rule in
        // any stylesheet, so the button was laid out wherever it happened to land.
        const rootAction = document.createElement('div');
        rootAction.style.cssText =
            'display: flex; align-items: center; justify-content: center; width: 100%; height: 100%;';
        rootAction.appendChild(openButton);

        const rootHeader = document.createElement('adw-header-bar');
        rootHeader.setAttribute('slot', 'top');
        rootHeader.appendChild(this._rootTitle);

        const rootToolbar = document.createElement('adw-toolbar-view');
        rootToolbar.append(rootHeader, rootAction);

        const rootPage = document.createElement('adw-navigation-page');
        rootPage.setAttribute('tag', 'root');
        rootPage.setAttribute('title', this.args.rootTitle as string);
        rootPage.appendChild(rootToolbar);

        // Root is the first child (auto-pushed); the detail is a static page made
        // reachable via push-by-tag.
        this._view.append(rootPage, this._detailPage);

        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._view) return;
        this._view.setAttribute('animate-transitions', (this.args.animateTransitions as boolean) ? 'true' : 'false');
        this._rootTitle?.setAttribute('title', this.args.rootTitle as string);
        const detailTitle = this.args.detailTitle as string;
        this._detailTitle?.setAttribute('title', detailTitle);
        this._detailStatus?.setAttribute('title', detailTitle);
        this._detailPage?.setAttribute('title', detailTitle);
    }
}

export const NavigationViewWebStories: WebStoryModule = { stories: [NavigationViewWebStory] };
