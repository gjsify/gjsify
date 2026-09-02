// Gtk.MenuButton — a button whose only job is to open a menu.
// original implementation.

import Gio from 'gi://Gio?version=2.0';
import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { MENU_BUTTON_ITEMS, menuButtonMeta } from './menu-button.meta.js';

/** Story: a Gtk.MenuButton over a Gio.Menu whose section carries the title. */
export class MenuButtonStory extends StoryWidget {
    private _widget: Gtk.MenuButton | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookMenuButton' }, MenuButtonStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(MenuButtonStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...menuButtonMeta, component: Gtk.MenuButton.$gtype };
    }

    initialize(): void {
        this._widget = new Gtk.MenuButton({ halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    /**
     * A Gio.Menu is immutable to the popover once shown, so the model is rebuilt
     * rather than mutated — the title lives on the SECTION, which is how GTK
     * spells a labelled group of items.
     */
    private _buildMenu(title: string): Gio.Menu {
        const items = new Gio.Menu();
        for (const label of MENU_BUTTON_ITEMS) {
            items.append(label, `app.${label.toLowerCase().replace(/[^a-z]+/g, '-')}`);
        }
        const menu = new Gio.Menu();
        menu.append_section(title.length > 0 ? title : null, items);
        return menu;
    }

    private _apply(): void {
        if (!this._widget) return;
        this._widget.iconName = this.args.iconName as string;
        this._widget.menuModel = this._buildMenu(this.args.menuTitle as string);
    }
}

GObject.type_ensure(MenuButtonStory.$gtype);

export const MenuButtonStories: StoryModule = { stories: [MenuButtonStory] };
