// Browser port of the List Box story. Shares metadata with list-box.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { LIST_BOX_ROWS, listBoxMeta } from '../../presentation/list-box.meta.js';

export class ListBoxWebStory extends StoryElement {
    private _box: HTMLElement | null = null;

    constructor() {
        super(ListBoxWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return listBoxMeta;
    }

    initialize(): void {
        this._box = document.createElement('gtk-list-box');
        this._box.style.width = '100%';
        // The rows GTK would WRAP around each appended child are the rows here, which is
        // the one thing the markup form has to spell.
        for (const title of LIST_BOX_ROWS) {
            const row = document.createElement('gtk-list-box-row');
            const label = document.createElement('gtk-label');
            label.setAttribute('label', title);
            row.appendChild(label);
            this._box.appendChild(row);
        }
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._box) return;
        this._box.setAttribute('selection-mode', this.args.selectionMode as string);
        this._box.toggleAttribute('show-separators', this.args.showSeparators as boolean);
        // `activate-on-single-click` defaults TRUE, so the bare attribute is the default and
        // `="false"` is how a story asks for a double click.
        this._box.setAttribute('activate-on-single-click', String(this.args.activateOnSingleClick as boolean));
        this._box.setAttribute('tab-behavior', this.args.tabBehavior as string);
    }
}

export const ListBoxWebStories: WebStoryModule = { stories: [ListBoxWebStory] };
