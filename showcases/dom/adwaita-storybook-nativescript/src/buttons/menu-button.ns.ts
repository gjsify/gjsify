// NativeScript port of the Menu Button story. Shares metadata with the GTK
// menu-button.story.ts and browser menu-button.web.ts (imported from the GTK
// showcase's renderer-agnostic *.meta.ts barrel).

import { StoryView, type StoryArgs, type StoryMeta, type NsStoryModule } from '@gjsify/storybook-nativescript';
import { Gtk } from '@gjsify/adwaita-nativescript';
import { documentOpenSymbolic, openMenuSymbolic, viewMoreSymbolic } from '@gjsify/adwaita-icons/actions';
import { MENU_BUTTON_ITEMS, menuButtonMeta } from '@gjsify/example-gtk-adwaita-storybook/metas';

// The GTK icon NAME the meta carries, resolved to the SVG string this renderer
// draws — NativeScript has no icon theme to look a name up in.
const ICONS: Record<string, string> = {
    'open-menu-symbolic': openMenuSymbolic,
    'view-more-symbolic': viewMoreSymbolic,
    'document-open-symbolic': documentOpenSymbolic,
};

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
        this._widget.menuItems = MENU_BUTTON_ITEMS.map((label) => ({ label }));
        this._apply();
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._widget) return;
        const name = this.args.iconName as string;
        this._widget.iconName = ICONS[name] ?? openMenuSymbolic;
        this._widget.menuTitle = this.args.menuTitle as string;
    }
}

export const MenuButtonNsStories: NsStoryModule = { stories: [MenuButtonNsStory] };
