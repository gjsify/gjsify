// Browser port of the Check Button story. Shares metadata with check-button.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { checkButtonMeta } from '../../controls/check-button.meta.js';

export class CheckButtonWebStory extends StoryElement {
    private _button: HTMLElement | null = null;

    constructor() {
        super(CheckButtonWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return checkButtonMeta;
    }

    initialize(): void {
        this._button = document.createElement('gtk-check-button');
        this._apply();
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        this._button.setAttribute('label', this.args.label as string);
        // `checked` and `indeterminate`, not GtkCheckButton's `active` / `inconsistent`:
        // the element wraps a real `<input>` and the stylesheet selects on these two.
        this._button.toggleAttribute('checked', this.args.checked as boolean);
        this._button.toggleAttribute('indeterminate', this.args.indeterminate as boolean);
        this._button.toggleAttribute('disabled', this.args.disabled as boolean);
    }
}

export const CheckButtonWebStories: WebStoryModule = { stories: [CheckButtonWebStory] };
