// NativeScript port of the Window Title story. Shares metadata with the GTK
// window-title.story.ts and browser window-title.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Adw } from '@gjsify/adwaita-nativescript';
import { windowTitleMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class WindowTitleNsStory extends StoryView {
    private _windowTitle: Adw.WindowTitle | null = null;

    constructor() {
        super(WindowTitleNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return windowTitleMeta;
    }

    initialize(): void {
        this._windowTitle = new Adw.WindowTitle();
        this._sync();
        this.addContent(this._windowTitle);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._windowTitle) return;
        this._windowTitle.title = this.args.title as string;
        this._windowTitle.subtitle = this.args.subtitle as string;
    }
}

export const WindowTitleNsStories: NsStoryModule = { stories: [WindowTitleNsStory] };
