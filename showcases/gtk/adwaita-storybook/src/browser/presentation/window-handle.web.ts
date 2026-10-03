// Browser port of the Window Handle story. Shares metadata with window-handle.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { windowHandleMeta } from '../../presentation/window-handle.meta.js';

export class WindowHandleWebStory extends StoryElement {
    private _handle: HTMLElement | null = null;

    constructor() {
        super(WindowHandleWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return windowHandleMeta;
    }

    initialize(): void {
        const handle = document.createElement('gtk-window-handle');
        const bar = document.createElement('adw-header-bar');
        const title = document.createElement('adw-window-title');
        title.setAttribute('title', 'Notes');
        bar.appendChild(title);
        handle.appendChild(bar);
        this._handle = handle;
        this._apply();
        this.addContent(handle);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const handle = this._handle;
        if (!handle) return;
        // The `gtk-titlebar-double-click` setting, spelled as the attribute a document can
        // write: the web port has no `Gtk.Settings` to resolve the action through.
        handle.setAttribute('double-click-action', this.args.action as string);
    }
}

export const WindowHandleWebStories: WebStoryModule = { stories: [WindowHandleWebStory] };
