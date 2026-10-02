// Gtk.ApplicationWindow — a Gtk.Window with an application menubar, and the property that
// decides whether the bar is shown.
// original implementation.

import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { gtkApplicationWindowMeta } from './gtk-application-window.meta.js';

/** The menu model the bar is built from — the thing no attribute can carry. */
function menubarModel(): Gio.Menu {
    const menu = new Gio.Menu();
    const file = new Gio.Menu();
    file.append('_New', 'win.new');
    file.append('_Open…', 'win.open');
    const edit = new Gio.Menu();
    edit.append('_Copy', 'win.copy');
    edit.append('_Paste', 'win.paste');
    menu.append_section(null, file);
    menu.append_section(null, edit);
    return menu;
}

/** Story: a Gtk.ApplicationWindow whose `show-menubar` and menu model are both driven by args. */
export class GtkApplicationWindowStory extends StoryWidget {
    private _window: Gtk.ApplicationWindow | null = null;
    private _application: Gtk.Application | null = null;
    private _menubar: Gio.Menu | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookGtkApplicationWindow' }, GtkApplicationWindowStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(GtkApplicationWindowStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...gtkApplicationWindowMeta, component: Gtk.ApplicationWindow.$gtype };
    }

    initialize(): void {
        this._application = new Gtk.Application({ application_id: 'eu.jumplink.AdwStorybookGtkApplicationWindow' });
        this._menubar = menubarModel();
        // The bar reads the MENU MODEL off the application, never off the window
        // (gtkapplicationwindow.c:337-348), so the story sets it on the application.
        this._application.set_menubar(this._menubar);

        this._window = new Gtk.ApplicationWindow({
            application: this._application,
            default_width: 460,
            default_height: 260,
        });
        this._window.set_titlebar(new Gtk.HeaderBar());
        const body = new Gtk.Box({
            orientation: Gtk.Orientation.VERTICAL,
            spacing: 12,
            margin_top: 12,
            margin_start: 12,
        });
        body.append(
            new Gtk.Label({ label: 'The bar above is built from the application menu.', css_classes: ['dimmed'] }),
        );
        this._window.set_child(body);

        this.addContent(this._window);
        this._apply();
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._window || !this._application) return;
        this._window.title = this.args.title as string;
        this._window.deletable = this.args.deletable as boolean;
        // The second half of `update_menubar`'s rule (:400-402): a window with no menubar at
        // all shows nothing, whatever `show-menubar` says. `set_menubar(null)` is the same
        // "no model" state an application starts in.
        this._application.set_menubar((this.args.hasMenubar as boolean) ? this._menubar : null);
        this._window.show_menubar = this.args.showMenubar as boolean;
    }
}

GObject.type_ensure(GtkApplicationWindowStory.$gtype);

export const GtkApplicationWindowStories: StoryModule = { stories: [GtkApplicationWindowStory] };
