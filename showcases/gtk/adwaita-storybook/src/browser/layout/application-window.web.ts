// Browser port of the Application Window story. Shares metadata with
// application-window.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { applicationWindowMeta } from '../../layout/application-window.meta.js';

/** The same menu both stories build, in the portable form (ADR 0042). */
const MENU_MODEL = [
    {
        label: 'File',
        submenu: [
            { label: 'New Window', action: 'app.new-window' },
            { label: 'Quit', action: 'app.quit' },
        ],
    },
    {
        label: 'Help',
        submenu: [
            { label: 'Keyboard Shortcuts', action: 'app.shortcuts' },
            { label: 'About', action: 'app.about' },
        ],
    },
];

/**
 * Story: adw-application-window with its menubar, a header bar and a status page —
 * a 1:1 port of the GTK ApplicationWindowStory.
 */
export class ApplicationWindowWebStory extends StoryElement {
    private _window: HTMLElement | null = null;
    private _title: HTMLElement | null = null;

    constructor() {
        super(ApplicationWindowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return applicationWindowMeta;
    }

    initialize(): void {
        this._title = document.createElement('adw-window-title');
        this._title.setAttribute('slot', 'title');

        const backButton = document.createElement('gtk-button');
        backButton.setAttribute('slot', 'start');
        backButton.setAttribute('icon', 'go-previous');
        backButton.setAttribute('flat', '');

        const headerBar = document.createElement('adw-header-bar');
        headerBar.style.width = '460px';
        headerBar.append(backButton, this._title);

        const toolbarView = document.createElement('adw-toolbar-view');
        toolbarView.append(headerBar);

        const statusPage = document.createElement('adw-status-page');
        statusPage.setAttribute('title', 'Your Library');
        statusPage.setAttribute('description', 'Content sits between the toolbars and scrolls independently of them.');
        toolbarView.append(statusPage);

        const window = document.createElement('adw-application-window');
        window.setAttribute('width', '460');
        window.setAttribute('height', '260');
        // The model an application would OWN on GTK. `show-menubar` decides whether the
        // window draws it, exactly as `Gtk.ApplicationWindow:show-menubar` does.
        window.setAttribute('menu-model', JSON.stringify(MENU_MODEL));
        this.applyMenubar(window, this.args.showMenubar as boolean);
        window.append(toolbarView);

        this._window = window;
        this._sync();
        this.addContent(window);
    }

    updateArgs(_args: StoryArgs): void {
        if (this._window) this.applyMenubar(this._window, this.args.showMenubar as boolean);
        this._sync();
    }

    /** The flag and the bar are ONE decision, the way the application window treats them. */
    private applyMenubar(window: HTMLElement, showing: boolean): void {
        if (showing) window.setAttribute('show-menubar', '');
        else window.removeAttribute('show-menubar');
    }

    private _sync(): void {
        if (!this._title) return;
        this._title.setAttribute('title', this.args.title as string);
        this._title.setAttribute('subtitle', this.args.subtitle as string);
    }
}

export const ApplicationWindowWebStories: WebStoryModule = { stories: [ApplicationWindowWebStory] };
