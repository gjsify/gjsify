// Browser port of the Viewport story. Shares metadata with viewport.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { viewportMeta } from '../../layout/viewport.meta.js';

export class ViewportWebStory extends StoryElement {
    private _viewport: HTMLElement | null = null;

    constructor() {
        super(ViewportWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return viewportMeta;
    }

    initialize(): void {
        const viewport = document.createElement('gtk-viewport');
        // An allocation, which is what GTK hands a viewport; without one it grows with its
        // content and has nothing to scroll.
        viewport.style.height = '240px';
        viewport.style.width = '260px';
        const box = document.createElement('gtk-box');
        box.setAttribute('orientation', 'vertical');
        box.setAttribute('spacing', '8');
        for (let i = 1; i <= 16; i++) {
            const label = document.createElement('gtk-label');
            label.setAttribute('label', `Row ${i}`);
            box.appendChild(label);
        }
        const button = document.createElement('gtk-button');
        button.setAttribute('label', 'Focus me');
        box.appendChild(button);
        viewport.appendChild(box);
        this._viewport = viewport;
        this._apply();
        this.addContent(viewport);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        const viewport = this._viewport;
        if (!viewport) return;
        viewport.setAttribute('scroll-to-focus', String(this.args.scrollToFocus as boolean));
    }
}

export const ViewportWebStories: WebStoryModule = { stories: [ViewportWebStory] };
