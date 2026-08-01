// Browser port of the Clamp story. Shares metadata with clamp.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { clampMeta } from '../../layout/clamp.meta.js';

export class ClampWebStory extends StoryElement {
    private _clamp: HTMLElement | null = null;

    constructor() {
        super(ClampWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return clampMeta;
    }

    initialize(): void {
        // The card fills the clamp, which caps its width at maximum-size and
        // centres it — so the text wraps within the clamped width (a fixed
        // width wider than the clamp would overflow and clip instead).
        const inner = document.createElement('adw-card');
        inner.style.width = '100%';
        inner.style.boxSizing = 'border-box';
        inner.style.padding = '18px';
        inner.textContent = 'This content is clamped — it stops growing past the maximum size and stays centred.';

        this._clamp = document.createElement('adw-clamp');
        this._clamp.append(inner);
        this._syncClamp();

        this.addContent(this._clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncClamp();
    }

    private _syncClamp(): void {
        if (!this._clamp) return;
        this._clamp.setAttribute('maximum-size', String(this.args.maximumSize as number));
    }
}

export const ClampWebStories: WebStoryModule = { stories: [ClampWebStory] };
