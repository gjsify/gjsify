// Browser port of the Popover Bin story. Shares metadata with popover-bin.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { POPOVER_BIN_ITEMS, popoverBinMeta } from '../../layout/popover-bin.meta.js';

export class PopoverBinWebStory extends StoryElement {
    private _bin!: HTMLElement;

    constructor() {
        super(PopoverBinWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return popoverBinMeta;
    }

    initialize(): void {
        this._bin = document.createElement('gtk-popover-bin');

        // A row-shaped child is what `.has-open-popup` is FOR — libadwaita's `_lists.scss`
        // reads it on a list row and `_sidebars.scss` on a sidebar row — and the bin keeps
        // it highlighted while its popup is up.
        const row = document.createElement('gtk-button');
        row.setAttribute('label', 'Right-click me');
        this._bin.appendChild(row);

        // The Menu key / the action, which is how a keyboard reaches the same popup the
        // gesture does (`gtk_shortcut_trigger_create_for_menu`, gtkpopoverbin.c:643-649).
        this._bin.addEventListener('keydown', (event) => {
            const key = event as KeyboardEvent;
            if (key.key === 'ContextMenu' && !key.shiftKey) {
                key.preventDefault();
                this._bin.dispatchEvent(new CustomEvent('menu.popup', { bubbles: true }));
                const popover = this._bin.querySelector('gtk-popover-menu') as HTMLElement & { open: boolean };
                popover.open = true;
            }
        });

        this._apply();
        this.addContent(this._bin);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._bin) return;
        this._bin.setAttribute('menu-model', JSON.stringify(POPOVER_BIN_ITEMS));
        this._bin.setAttribute('handle-input', String(this.args.handleInput as boolean));
    }
}

export const PopoverBinWebStories: WebStoryModule = { stories: [PopoverBinWebStory] };
