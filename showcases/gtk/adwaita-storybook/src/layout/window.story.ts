// Adw.Window — a freeform window with a header bar and content.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { windowMeta } from './window.meta.js';

/** Story: Adw.Window with a header bar and status page content. */
export class WindowStory extends StoryWidget {
    private _window: Adw.Window | null = null;
    private _title: Adw.WindowTitle | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookWindow' }, WindowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(WindowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...windowMeta, component: Adw.Window.$gtype };
    }

    initialize(): void {
        this._title = new Adw.WindowTitle({
            title: this.args.title as string,
            subtitle: this.args.subtitle as string,
        });

        const headerBar = new Adw.HeaderBar({ titleWidget: this._title, widthRequest: 460 });

        const backButton = new Gtk.Button({ iconName: 'go-previous-symbolic' });
        backButton.add_css_class('flat');
        headerBar.pack_start(backButton);

        const menuButton = new Gtk.MenuButton({ iconName: 'open-menu-symbolic' });
        menuButton.add_css_class('flat');
        headerBar.pack_end(menuButton);

        const toolbarView = new Adw.ToolbarView();
        toolbarView.add_top_bar(headerBar);

        const statusPage = new Adw.StatusPage({
            title: 'Your Library',
            description: 'Content sits between the toolbars and scrolls independently of them.',
        });
        toolbarView.content = statusPage;

        this._window = new Adw.Window({ content: toolbarView });

        this.addContent(this._window);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._title) return;
        this._title.title = this.args.title as string;
        this._title.subtitle = this.args.subtitle as string;
    }
}

GObject.type_ensure(WindowStory.$gtype);

export const WindowStories: StoryModule = { stories: [WindowStory] };
