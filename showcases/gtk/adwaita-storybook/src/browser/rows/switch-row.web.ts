// Browser port of the Switch Row story. Shares metadata with switch-row.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { switchRowMeta } from '../../rows/switch-row.meta.js';

export class SwitchRowWebStory extends StoryElement {
    private _row: HTMLElement | null = null;

    constructor() {
        super(SwitchRowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return switchRowMeta;
    }

    initialize(): void {
        this._row = document.createElement('adw-switch-row');
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
        this._row.toggleAttribute('active', this.args.active as boolean);
    }
}

export const SwitchRowWebStories: WebStoryModule = { stories: [SwitchRowWebStory] };
