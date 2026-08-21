// Browser port of the Entry Row story. Shares metadata with entry-row.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { entryRowMeta } from '../../rows/entry-row.meta.js';

export class EntryRowWebStory extends StoryElement {
    private _row: HTMLElement | null = null;

    constructor() {
        super(EntryRowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return entryRowMeta;
    }

    initialize(): void {
        this._row = document.createElement('adw-entry-row');
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
        this._row.setAttribute('text', this.args.text as string);
        this._row.toggleAttribute('show-apply-button', this.args.showApplyButton as boolean);
    }
}

export const EntryRowWebStories: WebStoryModule = { stories: [EntryRowWebStory] };
