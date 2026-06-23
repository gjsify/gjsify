// Browser port of the Spinner story. Shares metadata with spinner.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { spinnerMeta } from '../../presentation/spinner.meta.js';

export class SpinnerWebStory extends StoryElement {
    private _spinner: HTMLElement | null = null;

    constructor() {
        super(SpinnerWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return spinnerMeta;
    }

    initialize(): void {
        this._spinner = document.createElement('adw-spinner');
        this._spinner.setAttribute('size', String(this.args.size as number));
        this.addContent(this._spinner);
    }

    updateArgs(_args: StoryArgs): void {
        if (this._spinner) this._spinner.setAttribute('size', String(this.args.size as number));
    }
}

export const SpinnerWebStories: WebStoryModule = { stories: [SpinnerWebStory] };
