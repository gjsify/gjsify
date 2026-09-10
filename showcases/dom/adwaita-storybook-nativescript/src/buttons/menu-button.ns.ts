// NativeScript port of the Menu Button story. Shares metadata with the GTK
// menu-button.story.ts and browser menu-button.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

// The story's `iconName` control offers THEME NAMES, and since `icon-theme.ts` the port
// resolves one — so the local name-to-SVG map that used to sit here is gone. Seven of
// these existed across this showcase, each re-implementing the `-symbolic` strip and a
// switch over three or four names, each with its own fallback.

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Gtk } from '@gjsify/adwaita-nativescript';
import { MENU_BUTTON_ITEMS, menuButtonMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

export class MenuButtonNsStory extends StoryView {
    private _widget: Gtk.MenuButton | null = null;

    constructor() {
        super(MenuButtonNsStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return menuButtonMeta;
    }

    initialize(): void {
        this._widget = new Gtk.MenuButton();
        this._widget.menuModel = MENU_BUTTON_ITEMS.map((label) => ({ label }));
        this._apply();
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._widget) return;
        this._widget.iconName = this.args.iconName as string;
        this._widget.menuTitle = this.args.menuTitle as string;
    }
}

export const MenuButtonNsStories: NsStoryModule = { stories: [MenuButtonNsStory] };
