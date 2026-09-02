// Adw.WindowTitle — a header-bar title widget pairing a title with an
// optional subtitle. original implementation.

import Adw from 'gi://Adw?version=1';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { windowTitleMeta } from './window-title.meta.js';

/** Story: Adw.WindowTitle with live title / subtitle controls. */
export class WindowTitleStory extends StoryWidget {
    private _windowTitle: Adw.WindowTitle | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookWindowTitle' }, WindowTitleStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(WindowTitleStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...windowTitleMeta, component: Adw.WindowTitle.$gtype };
    }

    initialize(): void {
        this._windowTitle = new Adw.WindowTitle({
            title: this.args.title as string,
            subtitle: this.args.subtitle as string,
        });
        this.addContent(this._windowTitle);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._windowTitle) return;
        this._windowTitle.title = this.args.title as string;
        this._windowTitle.subtitle = this.args.subtitle as string;
    }
}

GObject.type_ensure(WindowTitleStory.$gtype);

export const WindowTitleStories: StoryModule = { stories: [WindowTitleStory] };
