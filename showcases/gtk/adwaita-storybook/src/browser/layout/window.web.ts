// Browser port of the Window story. Shares metadata with window.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { windowMeta } from '../../layout/window.meta.js';

export class WindowWebStory extends StoryElement {
    private _title: HTMLElement | null = null;

    constructor() {
        super(WindowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return windowMeta;
    }

    initialize(): void {
        this._title = document.createElement('adw-window-title');
        this._title.setAttribute('slot', 'center');

        const backButton = document.createElement('gtk-button');
        backButton.setAttribute('slot', 'start');
        backButton.setAttribute('icon', 'go-previous');
        backButton.setAttribute('flat', '');

        const menuButton = document.createElement('gtk-button');
        menuButton.setAttribute('slot', 'end');
        menuButton.setAttribute('icon', 'open-menu');
        menuButton.setAttribute('flat', '');

        const headerBar = document.createElement('adw-header-bar');
        headerBar.style.width = '460px';
        headerBar.append(backButton, this._title, menuButton);

        const statusPage = document.createElement('adw-status-page');
        statusPage.setAttribute('title', 'Your Library');
        statusPage.setAttribute('description', 'Content sits between the toolbars and scrolls independently of them.');

        const toolbarView = document.createElement('adw-toolbar-view');
        toolbarView.append(headerBar, statusPage);

        const win = document.createElement('adw-window');
        win.append(toolbarView);

        this._sync();
        this.addContent(win);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._title) return;
        this._title.setAttribute('title', this.args.title as string);
        this._title.setAttribute('subtitle', this.args.subtitle as string);
    }
}

export const WindowWebStories: WebStoryModule = { stories: [WindowWebStory] };
