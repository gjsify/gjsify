// Browser port of the List View story. Shares metadata with list-view.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { LIST_VIEW_ITEMS, listViewMeta } from '../../presentation/list-view.meta.js';

export class ListViewWebStory extends StoryElement {
    private _view: HTMLElement | null = null;

    constructor() {
        super(ListViewWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return listViewMeta;
    }

    initialize(): void {
        this._view = document.createElement('gtk-list-view');
        this._view.setAttribute('model', JSON.stringify(LIST_VIEW_ITEMS));
        this._apply();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._view) return;
        this._view.setAttribute('selection-mode', this.args.selectionMode as string);
        this._view.toggleAttribute('show-separators', this.args.showSeparators as boolean);
        this._view.toggleAttribute('single-click-activate', this.args.singleClickActivate as boolean);
    }
}

export const ListViewWebStories: WebStoryModule = { stories: [ListViewWebStory] };
