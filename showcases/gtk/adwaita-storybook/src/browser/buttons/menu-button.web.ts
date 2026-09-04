// Browser port of the Menu Button story. Shares metadata with menu-button.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { MENU_BUTTON_ITEMS, menuButtonMeta } from '../../buttons/menu-button.meta.js';

export class MenuButtonWebStory extends StoryElement {
    private _widget: HTMLElement | null = null;

    constructor() {
        super(MenuButtonWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return menuButtonMeta;
    }

    initialize(): void {
        this._widget = document.createElement('gtk-menu-button');
        this._widget.setAttribute('menu-model', JSON.stringify(MENU_BUTTON_ITEMS.map((label) => ({ label }))));
        this._apply();
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._widget) return;
        // The element takes symbolic names WITHOUT the `-symbolic` suffix — its icon
        // set is Adwaita's symbolic one, so the suffix would be part of every name.
        this._widget.setAttribute('icon-name', (this.args.iconName as string).replace(/-symbolic$/, ''));
        this._widget.setAttribute('menu-title', this.args.menuTitle as string);
    }
}

export const MenuButtonWebStories: WebStoryModule = { stories: [MenuButtonWebStory] };
