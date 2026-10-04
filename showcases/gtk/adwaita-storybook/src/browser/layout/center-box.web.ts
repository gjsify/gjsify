// Browser port of the Center Box story. Shares metadata with center-box.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { centerBoxMeta } from '../../layout/center-box.meta.js';

export class CenterBoxWebStory extends StoryElement {
    private _box: HTMLElement | null = null;

    constructor() {
        super(CenterBoxWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return centerBoxMeta;
    }

    initialize(): void {
        this._box = document.createElement('gtk-center-box');
        this._box.style.padding = '12px';
        for (const [slot, text] of [
            ['start-widget', 'Start'],
            ['center-widget', 'Centre'],
            ['end-widget', 'End'],
        ] as const) {
            const child = document.createElement('gtk-label');
            child.setAttribute('slot', slot);
            child.setAttribute('label', text);
            this._box.append(child);
        }
        this._apply();
        this.addContent(this._box);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._box) return;
        this._box.toggleAttribute('shrink-center-last', this.args.shrinkCenterLast as boolean);
        this._box.setAttribute('baseline-position', this.args.baselinePosition as string);
    }
}

export const CenterBoxWebStories: WebStoryModule = { stories: [CenterBoxWebStory] };
