// Adw.WindowTitle — a header-bar title widget pairing a title with an
// optional subtitle. original implementation.

import Adw from '@girs/adw-1';
import GObject from '@girs/gobject-2.0';
import { ControlType, type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';

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
        return {
            title: 'Presentation/Window Title',
            description: 'Adw.WindowTitle — a compact title/subtitle widget intended for a window or header bar.',
            component: Adw.WindowTitle.$gtype,
            controls: [
                { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Inbox' },
                { name: 'subtitle', label: 'Subtitle', type: ControlType.TEXT, defaultValue: '3 unread messages' },
            ],
        };
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
