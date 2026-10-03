// Gtk.FontDialogButton — a button that shows a font and opens a chooser for it.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import Pango from 'gi://Pango?version=1.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { fontDialogButtonMeta } from './font-dialog-button.meta.js';

/** Story: a Gtk.FontDialogButton with the level, the description and the two draw flags bound. */
export class FontDialogButtonStory extends StoryWidget {
    private _button: Gtk.FontDialogButton | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookFontDialogButton' }, FontDialogButtonStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(FontDialogButtonStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...fontDialogButtonMeta, component: Gtk.FontDialogButton.$gtype };
    }

    initialize(): void {
        this._button = new Gtk.FontDialogButton({ halign: Gtk.Align.CENTER });
        this._button.dialog = new Gtk.FontDialog();
        this._apply();
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        // `level` first: it decides whether the size box is visible at all, so writing the
        // description afterwards paints the label the new level asks for.
        this._button.level = this.args.level as string as Gtk.FontLevel;
        const desc = Pango.FontDescription.from_string(this.args.fontDesc as string);
        if (desc !== null) this._button.fontDesc = desc;
        // `use_size` is only consulted when `use_font` is set, so it goes second.
        this._button.useFont = this.args.useFont as boolean;
        this._button.useSize = this.args.useSize as boolean;
    }
}

GObject.type_ensure(FontDialogButtonStory.$gtype);

export const FontDialogButtonStories: StoryModule = { stories: [FontDialogButtonStory] };
