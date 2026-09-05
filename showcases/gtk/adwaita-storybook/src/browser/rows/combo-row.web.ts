// Browser port of the Combo Row story. Shares metadata with combo-row.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { COMBO_ROW_OPTIONS, comboRowMeta } from '../../rows/combo-row.meta.js';

export class ComboRowWebStory extends StoryElement {
    private _row: HTMLElement | null = null;

    constructor() {
        super(ComboRowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return comboRowMeta;
    }

    initialize(): void {
        this._row = document.createElement('adw-combo-row');
        this._row.setAttribute('model', JSON.stringify([...COMBO_ROW_OPTIONS]));
        this._syncRow();

        const group = document.createElement('adw-preferences-group');
        group.append(this._row);

        const clamp = document.createElement('adw-clamp');
        clamp.setAttribute('maximum-size', '400');
        clamp.append(group);

        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncRow();
    }

    private _syncRow(): void {
        if (!this._row) return;
        this._row.setAttribute('title', this.args.title as string);
        this._row.setAttribute('subtitle', this.args.subtitle as string);
        this._row.setAttribute('selected', String(this.args.selected as number));
    }
}

export const ComboRowWebStories: WebStoryModule = { stories: [ComboRowWebStory] };
