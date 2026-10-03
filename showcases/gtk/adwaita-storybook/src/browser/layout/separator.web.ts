// Browser port of the Separator story. Shares metadata with separator.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { separatorMeta } from '../../layout/separator.meta.js';

export class SeparatorWebStory extends StoryElement {
    private _box: HTMLElement | null = null;
    private _separator: HTMLElement | null = null;

    constructor() {
        super(SeparatorWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return separatorMeta;
    }

    initialize(): void {
        this._separator = document.createElement('gtk-separator');
        this._box = document.createElement('gtk-box');
        this._box.setAttribute('spacing', '12');
        for (const label of ['Above', 'Below']) {
            const text = document.createElement('gtk-label');
            text.setAttribute('label', label);
            // The separator sits BETWEEN the two labels.
            if (label === 'Below') this._box.appendChild(this._separator);
            this._box.appendChild(text);
        }
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._box || !this._separator) return;
        const vertical = this.args.orientation === 'vertical';
        this._separator.setAttribute('orientation', vertical ? 'vertical' : 'horizontal');
        // A rule runs ACROSS its box, so the box runs the other way.
        this._box.setAttribute('orientation', vertical ? 'horizontal' : 'vertical');
        this._separator.classList.toggle('spacer', this.args.spacer as boolean);
    }
}

export const SeparatorWebStories: WebStoryModule = { stories: [SeparatorWebStory] };
