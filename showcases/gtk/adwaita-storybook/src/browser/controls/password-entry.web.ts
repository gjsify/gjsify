// Browser port of the Password Entry story. Shares metadata with password-entry.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { passwordEntryMeta } from '../../controls/password-entry.meta.js';

export class PasswordEntryWebStory extends StoryElement {
    private _entry: HTMLElement | null = null;

    constructor() {
        super(PasswordEntryWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return passwordEntryMeta;
    }

    initialize(): void {
        this._entry = document.createElement('gtk-password-entry');
        this._entry.style.minWidth = '240px';
        this._apply();
        this.addContent(this._entry);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._entry) return;
        this._entry.toggleAttribute('show-peek-icon', this.args.showPeekIcon as boolean);
        this._entry.setAttribute('placeholder', this.args.placeholderText as string);
        this._entry.toggleAttribute('disabled', this.args.disabled as boolean);
    }
}

export const PasswordEntryWebStories: WebStoryModule = { stories: [PasswordEntryWebStory] };
