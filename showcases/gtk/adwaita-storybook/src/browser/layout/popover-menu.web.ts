// Browser port of the Popover Menu story. Shares metadata with popover-menu.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { POPOVER_MENU_ITEMS, popoverMenuMeta } from '../../layout/popover-menu.meta.js';

/** The two members the story drives that are properties rather than attributes. */
interface PopoverSurface extends HTMLElement {
    open: boolean;
}

export class PopoverMenuWebStory extends StoryElement {
    private _anchor!: HTMLButtonElement;
    private _popover!: PopoverSurface;

    constructor() {
        super(PopoverMenuWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return popoverMenuMeta;
    }

    initialize(): void {
        this._anchor = document.createElement('button');
        this._anchor.textContent = 'Open menu';
        this._popover = document.createElement('gtk-popover-menu') as unknown as PopoverSurface;
        this._popover.setAttribute('menu-model', JSON.stringify(POPOVER_MENU_ITEMS));
        this._anchor.appendChild(this._popover);
        this._apply();
        this.addContent(this._anchor);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._popover) return;
        // `start`/`end` are what GTK's LEFT/RIGHT become on a surface placed with logical
        // properties, so one control name serves both renderers.
        this._popover.setAttribute('position', this.args.position as string);
        this._popover.setAttribute('align', this.args.align as string);
        this._popover.setAttribute('autohide', String(this.args.autohide as boolean));
        this._popover.setAttribute('menu-title', this.args.menuTitle as string);
    }
}

export const PopoverMenuWebStories: WebStoryModule = { stories: [PopoverMenuWebStory] };
