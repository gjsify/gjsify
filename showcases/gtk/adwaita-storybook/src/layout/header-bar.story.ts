// Adw.HeaderBar — a window header bar with a custom title widget and packed buttons.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { headerBarMeta } from './header-bar.meta.js';

/** Story: Adw.HeaderBar with an Adw.WindowTitle, a start icon button and an end menu button. */
export class HeaderBarStory extends StoryWidget {
    private _headerBar: Adw.HeaderBar | null = null;
    private _title: Adw.WindowTitle | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookHeaderBar' }, HeaderBarStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(HeaderBarStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...headerBarMeta, component: Adw.HeaderBar.$gtype };
    }

    initialize(): void {
        this._title = new Adw.WindowTitle({
            title: this.args.title as string,
            subtitle: this.args.subtitle as string,
        });

        this._headerBar = new Adw.HeaderBar({
            titleWidget: this._title,
            showTitle: this.args.showTitle as boolean,
            widthRequest: 460,
        });

        const backButton = new Gtk.Button({ iconName: 'go-previous-symbolic' });
        backButton.add_css_class('flat');
        this._headerBar.pack_start(backButton);

        const menu = new Gio.Menu();
        menu.append('New Window', 'app.new-window');
        menu.append('Preferences', 'app.preferences');
        menu.append('About', 'app.about');

        const menuButton = new Gtk.MenuButton({ iconName: 'open-menu-symbolic', menuModel: menu });
        menuButton.add_css_class('flat');
        this._headerBar.pack_end(menuButton);

        this.addContent(this._headerBar);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._headerBar || !this._title) return;
        this._title.title = this.args.title as string;
        this._title.subtitle = this.args.subtitle as string;
        this._headerBar.showTitle = this.args.showTitle as boolean;
    }
}

GObject.type_ensure(HeaderBarStory.$gtype);

export const HeaderBarStories: StoryModule = { stories: [HeaderBarStory] };
