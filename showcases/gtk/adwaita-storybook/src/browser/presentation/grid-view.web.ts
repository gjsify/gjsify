// Browser port of the Grid View story. Shares metadata with grid-view.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { GRID_VIEW_ITEMS, gridViewMeta } from '../../presentation/grid-view.meta.js';

export class GridViewWebStory extends StoryElement {
    private _view: HTMLElement | null = null;

    constructor() {
        super(GridViewWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return gridViewMeta;
    }

    initialize(): void {
        this._view = document.createElement('gtk-grid-view');
        this._view.setAttribute('model', JSON.stringify(GRID_VIEW_ITEMS));
        this._apply();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._view) return;
        const min = Math.max(1, this.args.minColumns as number);
        this._view.setAttribute('min-columns', String(min));
        this._view.setAttribute('max-columns', String(Math.max(min, this.args.maxColumns as number)));
        this._view.setAttribute('selection-mode', this.args.selectionMode as string);
    }
}

export const GridViewWebStories: WebStoryModule = { stories: [GridViewWebStory] };
