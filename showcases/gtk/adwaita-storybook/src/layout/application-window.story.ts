// Adw.ApplicationWindow — an Adw.Window that belongs to a GtkApplication, and the
// menubar such an application installs.
// original implementation.

import Adw from 'gi://Adw?version=1';
import Gtk from 'gi://Gtk?version=4.0';
import Gio from 'gi://Gio?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { applicationWindowMeta } from './application-window.meta.js';

/** Story: Adw.ApplicationWindow with a menubar, a header bar and a status page. */
export class ApplicationWindowStory extends StoryWidget {
    private _window: Adw.ApplicationWindow | null = null;
    private _title: Adw.WindowTitle | null = null;
    private _toolbarView: Adw.ToolbarView | null = null;
    private _menubar: Gtk.PopoverMenuBar | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookApplicationWindow' }, ApplicationWindowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ApplicationWindowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...applicationWindowMeta, component: Adw.ApplicationWindow.$gtype };
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

        this._toolbarView = new Adw.ToolbarView();
        this._toolbarView.add_top_bar(headerBar);
        this._toolbarView.content = new Adw.StatusPage({
            title: 'Your Library',
            description: 'Content sits between the toolbars and scrolls independently of them.',
        });

        // The menubar is a row of LINKS, which is what `Gtk.Application:menubar` is
        // documented to be — two sections, each opening into its own popover.
        const menu = new Gio.Menu();
        const fileSection = new Gio.Menu();
        fileSection.append('New Window', 'app.new-window');
        fileSection.append('Quit', 'app.quit');
        menu.append_section(null, fileSection);
        const helpSection = new Gio.Menu();
        helpSection.append('Keyboard Shortcuts', 'app.shortcuts');
        helpSection.append('About', 'app.about');
        menu.append_section(null, helpSection);

        // Gtk.MenuBar is gone from GTK 4, so the row is a Gtk.PopoverMenuBar — and it is
        // the WIDGET an application window draws as its menubar. An app never adds it:
        // `Gtk.Application` installs the menu model at construction, and the property
        // this story toggles is what decides whether the window DRAWS it. A story has no
        // GtkApplication to install one, so it adds the same widget by hand, as the
        // toolbar view's second top bar, which is where the application window's own
        // menubar sits.
        this._menubar = new Gtk.PopoverMenuBar({ menu_model: menu });
        if (this.args.showMenubar as boolean) this._toolbarView.add_top_bar(this._menubar);

        this._window = new Adw.ApplicationWindow({
            content: this._toolbarView,
            show_menubar: this.args.showMenubar as boolean,
        });
        this._window.set_default_size(460, 260);

        this.addContent(this._window);
    }

    updateArgs(_args: StoryArgs): void {
        if (!this._title || !this._window || !this._toolbarView || !this._menubar) return;
        this._title.title = this.args.title as string;
        this._title.subtitle = this.args.subtitle as string;
        this._window.show_menubar = this.args.showMenubar as boolean;

        // The property and the bar are one decision, so the control moves both — which
        // is what the application window does with the menubar its application installed.
        const showing = this.args.showMenubar as boolean;
        if (showing && this._menubar.get_parent() === null) this._toolbarView.add_top_bar(this._menubar);
        if (!showing && this._menubar.get_parent() !== null) this._toolbarView.remove(this._menubar);
    }
}

GObject.type_ensure(ApplicationWindowStory.$gtype);

export const ApplicationWindowStories: StoryModule = { stories: [ApplicationWindowStory] };
