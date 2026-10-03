// Browser port of the Preferences Row story. Shares metadata with preferences-row.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { preferencesRowMeta } from '../../rows/preferences-row.meta.js';

export class PreferencesRowWebStory extends StoryElement {
    private _row: HTMLElement | null = null;

    constructor() {
        super(PreferencesRowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return preferencesRowMeta;
    }

    initialize(): void {
        this._row = document.createElement('adw-preferences-row');
        this._sync();

        const group = document.createElement('adw-preferences-group');
        group.append(this._row);

        const clamp = document.createElement('adw-clamp');
        clamp.setAttribute('maximum-size', '400');
        clamp.append(group);

        this.addContent(clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._row) return;
        this._row.setAttribute('title', this.args.title as string);
        this._row.toggleAttribute('use-markup', this.args.useMarkup as boolean);
        this._row.toggleAttribute('title-selectable', this.args.titleSelectable as boolean);
    }
}

export const PreferencesRowWebStories: WebStoryModule = { stories: [PreferencesRowWebStory] };
