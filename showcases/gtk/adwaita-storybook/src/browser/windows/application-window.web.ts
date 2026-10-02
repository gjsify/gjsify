// Browser port of the Application Window story. Shares metadata with application-window.story.ts.
//
// The menubar is a SLOT here, because GTK builds the bar from the application's menu model
// and no attribute can carry one — see `gtk-application-window.ts`. So the "the application has
// one" control adds and removes the SLOT rather than a `GMenuModel`.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { applicationWindowMeta } from '../../windows/application-window.meta.js';

export class ApplicationWindowWebStory extends StoryElement {
    private _window: HTMLElement | null = null;
    private _menubar: HTMLElement | null = null;

    constructor() {
        super(ApplicationWindowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return applicationWindowMeta;
    }

    initialize(): void {
        this._window = document.createElement('gtk-application-window');
        this._window.setAttribute('default-width', '460');
        this._window.setAttribute('default-height', '260');

        const bar = document.createElement('gtk-header-bar');
        bar.setAttribute('slot', 'titlebar');
        this._window.appendChild(bar);

        const note = document.createElement('span');
        note.textContent = 'The bar above the content is the application menubar.';
        this._window.appendChild(note);

        this._menubar = document.createElement('div');
        for (const label of ['File', 'Edit']) {
            const item = document.createElement('gtk-button');
            item.setAttribute('label', label);
            item.setAttribute('flat', '');
            this._menubar.appendChild(item);
        }

        this.addContent(this._window);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._window) return;
        this._window.setAttribute('title', this.args.title as string);
        this._window.setAttribute('deletable', String(this.args.deletable as boolean));
        this._window.setAttribute('show-menubar', String(this.args.showMenubar as boolean));
        // The second half of `update_menubar`'s rule (gtkapplicationwindow.c:400-402): a
        // window whose section has no items shows nothing, whatever the property says.
        const present = this._window.querySelector('.adw-gtk-application-window-menubar')?.childElementCount ?? 0;
        if (this.args.hasMenubar as boolean) {
            if (present === 0) this._window.appendChild(this._menubar as HTMLElement);
        } else if (present > 0) {
            (this._menubar as HTMLElement).remove();
        }
    }
}

export const ApplicationWindowWebStories: WebStoryModule = { stories: [ApplicationWindowWebStory] };
