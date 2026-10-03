// Browser port of the Layout Slot story. Shares metadata with layout-slot.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { layoutSlotMeta } from '../../layout/layout-slot.meta.js';

/**
 * A slot only ever exists inside a layout, and a layout only ever exists inside a
 * multi-layout view — the view is what inserts the child whose id matches the slot's. So
 * this story builds the whole pair and names the SLOT, which is the half a reader cannot
 * see anywhere else: the `visible` binding the view installs between the two
 * (adw-multi-layout-view.c:151).
 */
export class LayoutSlotWebStory extends StoryElement {
    private _view: HTMLElement | null = null;
    private _child: HTMLElement | null = null;

    constructor() {
        super(LayoutSlotWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return layoutSlotMeta;
    }

    initialize(): void {
        this._child = document.createElement('adw-navigation-page');
        this._child.setAttribute('tag', 'primary');
        this._child.setAttribute('slot', 'primary');
        const label = document.createElement('gtk-label');
        label.setAttribute('label', 'The child the view inserted here.');
        this._child.appendChild(label);

        this._view = document.createElement('adw-multi-layout-view');
        this._view.style.width = '360px';
        this._view.style.height = '120px';
        const layout = document.createElement('div');
        layout.setAttribute('name', 'only');
        const slot = document.createElement('adw-layout-slot');
        slot.setAttribute('id', 'primary');
        layout.appendChild(slot);
        this._view.appendChild(layout);
        this._view.appendChild(this._child);

        this._apply();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._child) return;
        this._child.setAttribute('title', this.args.label as string);
        // The binding is child → slot, one way: the slot cannot show what the child hides.
        this._child.toggleAttribute('hidden', !(this.args.visible as boolean));
    }
}

export const LayoutSlotWebStories: WebStoryModule = { stories: [LayoutSlotWebStory] };
