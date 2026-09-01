// Browser port of the Header Bar story. Shares metadata with header-bar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { headerBarMeta } from '../../layout/header-bar.meta.js';

export class HeaderBarWebStory extends StoryElement {
    private _headerBar: HTMLElement | null = null;
    private _title: HTMLElement | null = null;

    constructor() {
        super(HeaderBarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return headerBarMeta;
    }

    initialize(): void {
        // Center title widget — the equivalent of Adw.HeaderBar's title-widget.
        this._title = document.createElement('adw-window-title');
        this._title.setAttribute('slot', 'center');

        // Start control — a flat back button.
        const backButton = document.createElement('gtk-button');
        backButton.setAttribute('slot', 'start');
        backButton.setAttribute('icon', 'go-previous');
        backButton.setAttribute('flat', '');

        // End control — a flat menu button.
        const menuButton = document.createElement('gtk-button');
        menuButton.setAttribute('slot', 'end');
        menuButton.setAttribute('icon', 'open-menu');
        menuButton.setAttribute('flat', '');

        this._headerBar = document.createElement('adw-header-bar');
        this._headerBar.style.width = '460px';
        this._headerBar.append(backButton, this._title, menuButton);

        this._sync();
        this.addContent(this._headerBar);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._title) return;
        this._title.setAttribute('title', this.args.title as string);
        this._title.setAttribute('subtitle', this.args.subtitle as string);
        // Adw.HeaderBar.showTitle toggles visibility of the title widget.
        this._title.hidden = !(this.args.showTitle as boolean);
    }
}

export const HeaderBarWebStories: WebStoryModule = { stories: [HeaderBarWebStory] };
