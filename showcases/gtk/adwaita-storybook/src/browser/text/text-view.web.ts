// Browser port of the Text View story. Shares metadata with text-view.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { textViewMeta } from '../../text/text-view.meta.js';

/** The properties the story drives, as `<gtk-text-view>` spells them. */
interface TextViewControls {
    text: string;
    wrapMode: string;
    justification: string;
    monospace: boolean;
    acceptsTab: boolean;
    cursorVisible: boolean;
    topMargin: number;
}

export class TextViewWebStory extends StoryElement {
    private _view: (HTMLElement & TextViewControls) | null = null;

    constructor() {
        super(TextViewWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return textViewMeta;
    }

    initialize(): void {
        this._view = document.createElement('gtk-text-view') as HTMLElement & TextViewControls;
        // The text is set BEFORE the element is connected, so it arrives as the attribute the
        // element's light-DOM seed reads — the same door the GTK story's buffer text takes.
        this._view.text = this.args.text as string;
        this._apply();
        this.addContent(this._view);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._view) return;
        this._view.wrapMode = this.args.wrapMode as string;
        this._view.justification = this.args.justification as string;
        this._view.monospace = this.args.monospace as boolean;
        // `accepts-tab` and `cursor-visible` both default TRUE, so the element reads a VALUE
        // and the property is what writes it.
        this._view.acceptsTab = this.args.acceptsTab as boolean;
        this._view.cursorVisible = this.args.cursorVisible as boolean;
        this._view.topMargin = Number(this.args.topMargin ?? 0);
    }
}

export const TextViewWebStories: WebStoryModule = { stories: [TextViewWebStory] };
