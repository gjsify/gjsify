// Browser port of the Toggle Button story. Shares metadata with toggle-button.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { toggleButtonMeta } from '../../buttons/toggle-button.meta.js';

export class ToggleButtonWebStory extends StoryElement {
    private _button: HTMLElement | null = null;

    constructor() {
        super(ToggleButtonWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return toggleButtonMeta;
    }

    initialize(): void {
        this._button = document.createElement('gtk-toggle-button');
        this._apply();
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        this._button.setAttribute('label', this.args.label as string);
        this._button.toggleAttribute('active', this.args.active as boolean);
        this._button.toggleAttribute('flat', this.args.flat as boolean);
    }
}

export const ToggleButtonWebStories: WebStoryModule = { stories: [ToggleButtonWebStory] };
