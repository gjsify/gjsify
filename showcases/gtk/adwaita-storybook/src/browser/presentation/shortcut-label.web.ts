// Browser port of the Shortcut Label story. Shares metadata with shortcut-label.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { shortcutLabelMeta } from '../../presentation/shortcut-label.meta.js';

export class ShortcutLabelWebStory extends StoryElement {
    private _widget: HTMLElement | null = null;

    constructor() {
        super(ShortcutLabelWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return shortcutLabelMeta;
    }

    initialize(): void {
        this._widget = document.createElement('adw-shortcut-label');
        this._sync();
        this.addContent(this._widget);
    }

    updateArgs(_args: StoryArgs): void {
        this._sync();
    }

    /** `disabled-text` first: an empty accelerator renders the placeholder, so the
     *  placeholder has to be in place before the accelerator triggers the render. */
    private _sync(): void {
        if (!this._widget) return;
        this._widget.setAttribute('disabled-text', this.args.disabledText as string);
        this._widget.setAttribute('accelerator', this.args.accelerator as string);
    }
}

export const ShortcutLabelWebStories: WebStoryModule = { stories: [ShortcutLabelWebStory] };
