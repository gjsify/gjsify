// Browser port of the Scale Button story. Shares metadata with scale-button.meta.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { scaleButtonMeta, SCALE_BUTTON_ICONS } from '../../buttons/scale-button.meta.js';

export class ScaleButtonWebStory extends StoryElement {
    private _button: HTMLElement | null = null;

    constructor() {
        super(ScaleButtonWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return scaleButtonMeta;
    }

    initialize(): void {
        this._button = document.createElement('gtk-scale-button');
        this._button.setAttribute('icons', JSON.stringify(SCALE_BUTTON_ICONS));
        this._apply();
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        this._button.setAttribute('orientation', this.args.orientation as string);
        this._button.toggleAttribute('has-frame', this.args.hasFrame as boolean);
        this._button.setAttribute('value', String(this.args.value));
    }
}

export const ScaleButtonWebStories: WebStoryModule = { stories: [ScaleButtonWebStory] };
