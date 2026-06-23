// Browser port of the Password Entry Row story. Shares metadata with
// password-entry-row.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { passwordEntryRowMeta } from '../../rows/password-entry-row.meta.js';

export class PasswordEntryRowWebStory extends StoryElement {
    private _row: HTMLElement | null = null;

    constructor() {
        super(PasswordEntryRowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return passwordEntryRowMeta;
    }

    initialize(): void {
        this._row = document.createElement('adw-password-entry-row');
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
    }
}

export const PasswordEntryRowWebStories: WebStoryModule = { stories: [PasswordEntryRowWebStory] };
