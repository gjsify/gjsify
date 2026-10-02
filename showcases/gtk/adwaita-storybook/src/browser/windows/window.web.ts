// Browser port of the Window story. Shares metadata with window.story.ts.
//
// The replica is an IN-PAGE FRAME, not a toplevel — see `gtk-window.ts`. The one thing this
// story has to add for that to read is the `close-request` handler: GTK's default handler
// destroys the window unless `hide-on-close`, and an application that wants to keep it
// cancels the signal.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { windowMeta } from '../../windows/window.meta.js';

export class WindowWebStory extends StoryElement {
    private _window: HTMLElement | null = null;
    private _bar: HTMLElement | null = null;

    constructor() {
        super(WindowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return windowMeta;
    }

    initialize(): void {
        this._window = document.createElement('gtk-window');
        this._window.setAttribute('default-width', '460');
        this._window.setAttribute('default-height', '280');

        // `decorated: false` DROPS the titlebar strip, so the story keeps the bar in the TREE
        // and lets the property decide whether it is seen (gtkwindow.c:1014).
        this._bar = document.createElement('gtk-header-bar');
        this._bar.setAttribute('slot', 'titlebar');
        this._window.appendChild(this._bar);

        const note = document.createElement('span');
        note.textContent = 'The frame above is a Gtk.HeaderBar.';
        this._window.appendChild(note);

        this.addContent(this._window);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._window) return;
        this._window.setAttribute('title', this.args.title as string);
        this._window.setAttribute('decorated', String(this.args.decorated as boolean));
        this._window.setAttribute('deletable', String(this.args.deletable as boolean));
        this._window.setAttribute('resizable', String(this.args.resizable as boolean));
        this._window.setAttribute('maximized', String(this.args.maximized as boolean));
        this._window.setAttribute('modal', String(this.args.modal as boolean));
        this._window.setAttribute('hide-on-close', String(this.args.hideOnClose as boolean));
    }
}

export const WindowWebStories: WebStoryModule = { stories: [WindowWebStory] };
