// Browser port of the Inscription story. Shares metadata with inscription.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { inscriptionMeta } from '../../media/inscription.meta.js';

export class InscriptionWebStory extends StoryElement {
    private _inscription: HTMLElement | null = null;
    private _frame: HTMLElement | null = null;

    constructor() {
        super(InscriptionWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return inscriptionMeta;
    }

    initialize(): void {
        // The frame is the fixed box the counts are shown against, as in the GTK story — an
        // inscription in an unconstrained column shrinks to its minimum and the `nat` counts
        // visibly do nothing.
        this._frame = document.createElement('div');
        this._frame.style.cssText =
            'width:320px;height:160px;border:1px solid var(--separator-color);display:flex;align-items:stretch;justify-content:stretch;';
        this._inscription = document.createElement('gtk-inscription');
        this._frame.appendChild(this._inscription);
        this._apply();
        this.addContent(this._frame);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._inscription) return;
        // The ORDER is the measure, exactly as in the GTK story: the natural is
        // `MAX (min_chars, nat_chars)` (gtkinscription.c:348), so both counts precede the
        // text and a later `min` cannot pull the natural below the larger of the two.
        this._inscription.setAttribute('min-chars', String(this.args.minChars as number));
        this._inscription.setAttribute('nat-chars', String(this.args.natChars as number));
        this._inscription.setAttribute('min-lines', String(this.args.minLines as number));
        this._inscription.setAttribute('nat-lines', String(this.args.natLines as number));
        this._inscription.setAttribute('text', this.args.text as string);
        this._inscription.setAttribute('wrap-mode', this.args.wrapMode as string);
        this._inscription.setAttribute('text-overflow', this.args.textOverflow as string);
        this._inscription.setAttribute('xalign', String(this.args.xalign as number));
        this._inscription.setAttribute('yalign', String(this.args.yalign as number));
    }
}

export const InscriptionWebStories: WebStoryModule = { stories: [InscriptionWebStory] };
