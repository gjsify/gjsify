// Browser port of the Wrap Box story. Shares metadata with wrap-box.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { wrapBoxMeta } from '../../layout/wrap-box.meta.js';

const TAGS = ['Design', 'Adwaita', 'GNOME', 'GTK', 'Typescript', 'Storybook', 'Wrapping', 'Layout'];

export class WrapBoxWebStory extends StoryElement {
    private _wrap: HTMLElement | null = null;

    constructor() {
        super(WrapBoxWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return wrapBoxMeta;
    }

    initialize(): void {
        this._wrap = document.createElement('adw-wrap-box');
        this._wrap.style.width = '460px';

        for (const tag of TAGS) {
            const chip = document.createElement('gtk-button');
            chip.setAttribute('label', tag);
            chip.setAttribute('pill', '');
            this._wrap.append(chip);
        }

        this._syncWrap();
        this.addContent(this._wrap);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncWrap();
    }

    private _syncWrap(): void {
        if (!this._wrap) return;
        this._wrap.setAttribute('child-spacing', String(this.args.childSpacing as number));
        this._wrap.setAttribute('line-spacing', String(this.args.lineSpacing as number));
    }
}

export const WrapBoxWebStories: WebStoryModule = { stories: [WrapBoxWebStory] };
