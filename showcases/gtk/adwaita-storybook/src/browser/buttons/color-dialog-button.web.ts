// Browser port of the Color Dialog Button story. Shares metadata with
// color-dialog-button.meta.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { colorDialogButtonMeta } from '../../buttons/color-dialog-button.meta.js';
import type { Gtk } from '@gjsify/adwaita-web';

export class ColorDialogButtonWebStory extends StoryElement {
    private _button: Gtk.ColorDialogButton | null = null;

    constructor() {
        super(ColorDialogButtonWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return colorDialogButtonMeta;
    }

    initialize(): void {
        this._button = document.createElement('gtk-color-dialog-button') as Gtk.ColorDialogButton;
        // The `dialog` attribute is what makes the button sensitive: the element's rule is
        // GTK's `dialog != NULL && cancellable == NULL`.
        this._button.setAttribute('dialog', '');
        this._apply();
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        this._button.setAttribute('rgba', this.args.rgba as string);
        // `title` is a property of the DIALOG, not of the button, so it goes through the
        // dialog rather than an attribute the element does not observe.
        const title = (this.args.title as string).trim();
        this._button.dialog = { title: title === '' ? null : title };
    }
}

export const ColorDialogButtonWebStories: WebStoryModule = { stories: [ColorDialogButtonWebStory] };
