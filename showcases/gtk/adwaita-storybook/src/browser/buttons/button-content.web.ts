// Browser port of the Button Content story — an <adw-button-content> (icon +
// label) inside a suggested-action pill <gtk-button>, mirroring the GTK twin
// (button-content.story.ts) which places an Adw.ButtonContent inside a
// Gtk.Button with the .suggested-action + .pill style classes.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { buttonContentMeta } from '../../buttons/button-content.meta.js';

/** GTK symbolic name (e.g. "folder-download-symbolic") → adwaita-web icon-name. */
function iconName(gtkName: string): string {
    return gtkName.replace(/-symbolic$/, '');
}

export class ButtonContentWebStory extends StoryElement {
    private _content: HTMLElement | null = null;

    constructor() {
        super(ButtonContentWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return buttonContentMeta;
    }

    initialize(): void {
        this._content = document.createElement('adw-button-content');
        this._syncContent();

        // The native story wraps the content in a suggested-action pill button.
        // Use a plain button carrying the .adw-button style classes (the
        // <gtk-button> custom element rebuilds its subtree from attributes and
        // would discard the nested <adw-button-content>).
        const button = document.createElement('button');
        button.className = 'adw-button suggested-action pill';
        button.append(this._content);

        this.addContent(button);
    }

    updateArgs(_args: StoryArgs): void {
        this._syncContent();
    }

    private _syncContent(): void {
        if (!this._content) return;

        this._content.setAttribute('label', this.args.label as string);
        this._content.setAttribute('icon-name', iconName(this.args.iconName as string));

        if (this.args.canShrink) this._content.setAttribute('can-shrink', '');
        else this._content.removeAttribute('can-shrink');
    }
}

export const ButtonContentWebStories: WebStoryModule = { stories: [ButtonContentWebStory] };
