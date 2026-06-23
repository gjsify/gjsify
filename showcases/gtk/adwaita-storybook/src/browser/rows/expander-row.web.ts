// Browser port of the Expander Row story. Shares metadata with expander-row.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { expanderRowMeta } from '../../rows/expander-row.meta.js';

export class ExpanderRowWebStory extends StoryElement {
    private _row: HTMLElement | null = null;

    constructor() {
        super(ExpanderRowWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return expanderRowMeta;
    }

    initialize(): void {
        this._row = document.createElement('adw-expander-row');

        const hostRow = document.createElement('adw-entry-row');
        hostRow.setAttribute('title', 'Host');
        hostRow.setAttribute('text', 'proxy.example.com');

        const authRow = document.createElement('adw-switch-row');
        authRow.setAttribute('title', 'Use authentication');

        this._row.append(hostRow, authRow);
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
        this._row.toggleAttribute('expanded', this.args.expanded as boolean);
        this._row.toggleAttribute('show-enable-switch', this.args.showEnableSwitch as boolean);
    }
}

export const ExpanderRowWebStories: WebStoryModule = { stories: [ExpanderRowWebStory] };
