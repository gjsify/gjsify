// Browser port of the Aspect Frame story. Shares metadata with aspect-frame.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { aspectFrameMeta } from '../../layout/aspect-frame.meta.js';

export class AspectFrameWebStory extends StoryElement {
    private _frame: HTMLElement | null = null;

    constructor() {
        super(AspectFrameWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return aspectFrameMeta;
    }

    initialize(): void {
        this._frame = document.createElement('gtk-aspect-frame');
        // The GTK story asks for 320x180, which is what makes the ratio visible in both.
        this._frame.style.width = '320px';
        this._frame.style.height = '180px';
        const body = document.createElement('gtk-label');
        body.setAttribute(
            'label',
            'The frame gives this child the ratio above, and puts it where xalign and yalign say.',
        );
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
        this._frame.setAttribute('ratio', String(this.args.ratio as number));
        // Read, and it may well move nothing: the child fills the frame's width here, so
        // there is no horizontal slack left for `xalign` to place it in — the divergence
        // `gtk-aspect-frame.ts`'s header states. `yalign` below is the axis that moves.
        this._frame.setAttribute('xalign', String(this.args.xalign as number));
        this._frame.setAttribute('yalign', String(this.args.yalign as number));
        this._frame.setAttribute('obey-child', String(this.args.obeyChild as boolean));
    }
}

export const AspectFrameWebStories: WebStoryModule = { stories: [AspectFrameWebStory] };
