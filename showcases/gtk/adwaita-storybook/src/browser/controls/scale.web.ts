// Browser port of the Scale story. Shares metadata with scale.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { scaleMeta } from '../../controls/scale.meta.js';

export class ScaleWebStory extends StoryElement {
    private _scale: HTMLElement | null = null;

    constructor() {
        super(ScaleWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return scaleMeta;
    }

    initialize(): void {
        this._scale = document.createElement('gtk-scale');
        this._scale.style.width = '260px';
        this._apply();
        this.addContent(this._scale);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._scale) return;
        this._scale.setAttribute('orientation', this.args.orientation as string);
        this._scale.setAttribute('value-pos', this.args.valuePos as string);
        this._scale.toggleAttribute('draw-value', this.args.drawValue as boolean);
        this._scale.setAttribute('digits', String(this.args.digits as number));
        this._scale.toggleAttribute('inverted', this.args.inverted as boolean);
        // `has-origin` is TRUE by default, so it is the absence of the attribute that
        // withdraws the highlight — the same inversion `GtkPasswordEntry.revealed` uses.
        if (this.args.hasOrigin as boolean) this._scale.removeAttribute('has-origin');
        else this._scale.setAttribute('has-origin', 'false');
        this._scale.setAttribute('adjustment', '{"lower":0,"upper":100,"stepIncrement":1,"pageIncrement":10}');
        this._scale.setAttribute('value', String(this.args.value as number));
    }
}

export const ScaleWebStories: WebStoryModule = { stories: [ScaleWebStory] };
