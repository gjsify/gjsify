// Browser port of the Popover story. Shares metadata with popover.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { popoverMeta } from '../../layout/popover.meta.js';

/** The two members the story drives that are properties rather than attributes. */
interface PopoverSurface extends HTMLElement {
    open: boolean;
}

export class PopoverWebStory extends StoryElement {
    private _anchor!: HTMLButtonElement;
    private _popover!: PopoverSurface;

    constructor() {
        super(PopoverWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return popoverMeta;
    }

    initialize(): void {
        this._anchor = document.createElement('button');
        this._anchor.textContent = 'Show popover';

        this._popover = document.createElement('gtk-popover') as unknown as PopoverSurface;
        // A plain content popover, NOT the `.menu` variant: `popover > contents` pads 8px,
        // where a menu popover re-declares 0 and moves the inset to the item box
        // (`popover.menu > contents`, _menus.scss:58-66).
        const box = document.createElement('div');
        box.style.cssText = 'display:flex;flex-direction:column;gap:6px;';
        for (const label of ['Anything you like', 'in here']) {
            const line = document.createElement('span');
            line.textContent = label;
            box.appendChild(line);
        }
        this._popover.appendChild(box);

        this._anchor.appendChild(this._popover);
        this._anchor.addEventListener('click', () => {
            this._popover.open = !this._popover.open;
        });
        this._apply();
        this.addContent(this._anchor);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._popover) return;
        this._popover.setAttribute('position', this.args.position as string);
        this._popover.setAttribute('align', this.args.align as string);
        // Default-TRUE, so the attribute has to be able to say BOTH values here.
        this._popover.setAttribute('autohide', String(this.args.autohide as boolean));
    }
}

export const PopoverWebStories: WebStoryModule = { stories: [PopoverWebStory] };
