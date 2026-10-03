// Browser port of the Spin Button story. Shares metadata with spin-button.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { spinButtonMeta } from '../../controls/spin-button.meta.js';

export class SpinButtonWebStory extends StoryElement {
    private _spin: HTMLElement | null = null;

    constructor() {
        super(SpinButtonWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return spinButtonMeta;
    }

    initialize(): void {
        this._spin = document.createElement('gtk-spin-button');
        this._apply();
        this.addContent(this._spin);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._spin) return;
        this._spin.setAttribute('orientation', this.args.orientation as string);
        this._spin.setAttribute('digits', String(this.args.digits as number));
        this._spin.toggleAttribute('numeric', this.args.numeric as boolean);
        this._spin.toggleAttribute('snap-to-ticks', this.args.snapToTicks as boolean);
        this._spin.toggleAttribute('wrap', this.args.wrap as boolean);
        this._spin.setAttribute('update-policy', this.args.updatePolicy as string);
        this._spin.setAttribute('adjustment', '{"lower":0,"upper":10,"stepIncrement":1,"pageIncrement":2}');
        this._spin.setAttribute('value', String(this.args.value as number));
    }
}

export const SpinButtonWebStories: WebStoryModule = { stories: [SpinButtonWebStory] };
