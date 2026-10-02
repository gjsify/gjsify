// Gtk.Text — the single-line text widget every Gtk.Entry is built on, shown standalone.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { textMeta } from './text.meta.js';

/** Story: a Gtk.Text with its text, placeholder, mask, limit and width policy bound to args. */
export class TextStory extends StoryWidget {
    private _text: Gtk.Text | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookText' }, TextStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(TextStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...textMeta, component: Gtk.Text.$gtype };
    }

    initialize(): void {
        this._text = new Gtk.Text({ halign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._text);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._text) return;
        // The two booleans GTK's pspec defaults to TRUE, written through the PROPERTY rather
        // than a bare attribute, exactly as the element reads them (gtktext.c:1774-1805).
        this._text.text = this.args.text as string;
        this._text.placeholder_text = this.args.placeholderText as string;
        this._text.editable = this.args.editable as boolean;
        this._text.visibility = this.args.visibility as boolean;
        this._text.max_length = Number(this.args.maxLength ?? 0);
        this._text.propagate_text_width = this.args.propagateTextWidth as boolean;
    }
}

GObject.type_ensure(TextStory.$gtype);

export const TextStories: StoryModule = { stories: [TextStory] };
