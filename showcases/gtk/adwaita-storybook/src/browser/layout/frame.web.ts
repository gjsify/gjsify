// Browser port of the Frame story. Shares metadata with frame.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { frameMeta } from '../../layout/frame.meta.js';

export class FrameWebStory extends StoryElement {
    private _frame: HTMLElement | null = null;

    constructor() {
        super(FrameWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return frameMeta;
    }

    initialize(): void {
        this._frame = document.createElement('gtk-frame');
        const body = document.createElement('gtk-label');
        body.setAttribute('label', 'A framed region: the label sits in the top edge of the border.');
        body.style.padding = '12px';
        this._frame.append(body);
        this._apply();
        this.addContent(this._frame);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._frame) return;
        const label = this.args.label as string;
        if (label === '') this._frame.removeAttribute('label');
        else this._frame.setAttribute('label', label);
        this._frame.setAttribute('label-xalign', String(this.args.labelXalign as number));
    }
}

export const FrameWebStories: WebStoryModule = { stories: [FrameWebStory] };
