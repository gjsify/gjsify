// Browser port of the Clamp Scrollable story. Shares metadata with clamp-scrollable.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { clampScrollableMeta } from '../../layout/clamp-scrollable.meta.js';

const LINES = Array.from({ length: 24 }, (_, i) => `Line ${i + 1}: held at the clamp's width while it scrolls.`);

export class ClampScrollableWebStory extends StoryElement {
    private _clamp: HTMLElement | null = null;

    constructor() {
        super(ClampScrollableWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return clampScrollableMeta;
    }

    initialize(): void {
        const text = document.createElement('div');
        text.style.padding = '12px 0';
        for (const line of LINES) {
            const row = document.createElement('div');
            row.textContent = line;
            text.append(row);
        }

        this._clamp = document.createElement('adw-clamp-scrollable');
        this._clamp.style.width = '640px';
        this._clamp.style.height = '240px';
        this._clamp.append(text);
        this._sync();
        this.addContent(this._clamp);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    private _sync(): void {
        if (!this._clamp) return;
        this._clamp.setAttribute('maximum-size', String(this.args.maximumSize as number));
        this._clamp.setAttribute('tightening-threshold', String(this.args.tighteningThreshold as number));
    }
}

export const ClampScrollableWebStories: WebStoryModule = { stories: [ClampScrollableWebStory] };
