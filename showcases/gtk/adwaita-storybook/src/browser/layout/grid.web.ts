// Browser port of the Grid story. Shares metadata with grid.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { gridMeta } from '../../layout/grid.meta.js';

export class GridWebStory extends StoryElement {
    private _grid: HTMLElement | null = null;

    constructor() {
        super(GridWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return gridMeta;
    }

    initialize(): void {
        this._grid = document.createElement('gtk-grid');
        this._grid.style.padding = '12px';
        // Source order IS the placement here: a CSS grid fills row by row, which is what
        // `attach(child, -1, -1, 1, 1)` does in the GTK rendering.
        for (const text of ['Name', 'Value', 'Unit', 'editable']) {
            const cell = document.createElement('gtk-label');
            cell.setAttribute('label', text);
            cell.style.padding = '6px';
            this._grid.append(cell);
        }
        this._apply();
        this.addContent(this._grid);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._grid) return;
        this._grid.setAttribute('column-spacing', String(this.args.columnSpacing as number));
        this._grid.setAttribute('row-spacing', String(this.args.rowSpacing as number));
        this._grid.toggleAttribute('column-homogeneous', this.args.columnHomogeneous as boolean);
        this._grid.toggleAttribute('row-homogeneous', this.args.rowHomogeneous as boolean);
        this._grid.setAttribute('orientation', this.args.orientation as string);
    }
}

export const GridWebStories: WebStoryModule = { stories: [GridWebStory] };
