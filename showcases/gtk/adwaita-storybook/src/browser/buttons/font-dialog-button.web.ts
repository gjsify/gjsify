// Browser port of the Font Dialog Button story. Shares metadata with
// font-dialog-button.meta.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { fontDialogButtonMeta } from '../../buttons/font-dialog-button.meta.js';
import type { Gtk } from '@gjsify/adwaita-web';

export class FontDialogButtonWebStory extends StoryElement {
    private _button: Gtk.FontDialogButton | null = null;

    constructor() {
        super(FontDialogButtonWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return fontDialogButtonMeta;
    }

    initialize(): void {
        this._button = document.createElement('gtk-font-dialog-button') as Gtk.FontDialogButton;
        // Without a dialog the button is insensitive, GTK's rule being
        // `dialog != NULL && cancellable == NULL`.
        this._button.setAttribute('dialog', '');
        this._apply();
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        // `level` first: it decides whether the size box is visible at all.
        this._button.setAttribute('level', this.args.level as string);
        this._button.setAttribute('font-desc', this.args.fontDesc as string);
        this._button.toggleAttribute('use-font', this.args.useFont as boolean);
        this._button.toggleAttribute('use-size', this.args.useSize as boolean);
    }
}

export const FontDialogButtonWebStories: WebStoryModule = { stories: [FontDialogButtonWebStory] };
