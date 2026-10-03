// Browser port of the Popover Menu Bar story. Shares metadata with
// popover-menu-bar.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { POPOVER_MENU_BAR_ITEMS, popoverMenuBarMeta } from '../../navigation/popover-menu-bar.meta.js';

export class PopoverMenuBarWebStory extends StoryElement {
    private _bar!: HTMLElement;

    constructor() {
        super(PopoverMenuBarWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return popoverMenuBarMeta;
    }

    initialize(): void {
        this._bar = document.createElement('gtk-popover-menu-bar');
        this._apply();
        this.addContent(this._bar);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bar) return;
        const entries = this.args.showLast === false ? POPOVER_MENU_BAR_ITEMS.slice(0, 3) : POPOVER_MENU_BAR_ITEMS;
        this._bar.setAttribute('menu-model', JSON.stringify(entries));
        // `position` reaches each item's popover, exactly as the GTK story walks the bar's
        // children — the popovers are the bar's, not the bar's own placement.
        for (const popover of this._bar.querySelectorAll('gtk-popover-menu')) {
            popover.setAttribute('position', this.args.position as string);
        }
    }
}

export const PopoverMenuBarWebStories: WebStoryModule = { stories: [PopoverMenuBarWebStory] };
