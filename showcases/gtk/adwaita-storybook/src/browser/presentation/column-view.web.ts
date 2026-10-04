// Browser port of the Column View story. Shares metadata with column-view.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { COLUMN_VIEW_ITEMS, columnViewMeta } from '../../presentation/column-view.meta.js';

export class ColumnViewWebStory extends StoryElement {
    private _view: HTMLElement | null = null;

    constructor() {
        super(ColumnViewWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return columnViewMeta;
    }

    initialize(): void {
        this._view = document.createElement('gtk-column-view');
        this._view.setAttribute('model', JSON.stringify(COLUMN_VIEW_ITEMS));
        // The same two fields the GTK story gives its two column factories: the label and
        // the id beside it.
        this._view.setAttribute(
            'columns',
            JSON.stringify([
                { key: 'label', id: 'name', title: 'Name', expand: true, sortable: true },
                { key: 'value', id: 'code', title: 'Code' },
            ]),
        );
        this._apply();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._view) return;
        this._view.toggleAttribute('show-row-separators', this.args.showRowSeparators as boolean);
        this._view.toggleAttribute('show-column-separators', this.args.showColumnSeparators as boolean);
        this._view.toggleAttribute('reorderable', this.args.reorderable as boolean);
    }
}

export const ColumnViewWebStories: WebStoryModule = { stories: [ColumnViewWebStory] };
