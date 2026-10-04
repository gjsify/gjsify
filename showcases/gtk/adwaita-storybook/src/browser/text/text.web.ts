// Browser port of the Text story. Shares metadata with text.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { textMeta } from '../../text/text.meta.js';

export class TextWebStory extends StoryElement {
    private _text: HTMLElement | null = null;

    constructor() {
        super(TextWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return textMeta;
    }

    initialize(): void {
        this._text = document.createElement('gtk-text');
        this._apply();
        this.addContent(this._text);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._text) return;
        const text = this._text as HTMLElement & {
            text: string;
            placeholderText: string;
            editable: boolean;
            visibility: boolean;
            maxLength: number;
            propagateTextWidth: boolean;
        };
        text.text = this.args.text as string;
        text.placeholderText = this.args.placeholderText as string;
        // `editable` and `visibility` default TRUE in GTK, so the element reads them from a
        // VALUE — written here through the property so the story never has to spell `false`.
        text.editable = this.args.editable as boolean;
        text.visibility = this.args.visibility as boolean;
        text.maxLength = Number(this.args.maxLength ?? 0);
        text.propagateTextWidth = this.args.propagateTextWidth as boolean;
    }
}

export const TextWebStories: WebStoryModule = { stories: [TextWebStory] };
