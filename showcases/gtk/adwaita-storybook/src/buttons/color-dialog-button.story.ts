// Gtk.ColorDialogButton — a button that shows a colour and opens a chooser for it.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { colorDialogButtonMeta } from './color-dialog-button.meta.js';

/** Story: a Gtk.ColorDialogButton with a dialog, its colour and the dialog's title bound. */
export class ColorDialogButtonStory extends StoryWidget {
    private _button: Gtk.ColorDialogButton | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookColorDialogButton' }, ColorDialogButtonStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ColorDialogButtonStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...colorDialogButtonMeta, component: Gtk.ColorDialogButton.$gtype };
    }

    initialize(): void {
        // The dialog is what makes the button sensitive at all, so it is set BEFORE the
        // colour: `update_button_sensitivity` is `dialog != NULL && cancellable == NULL`.
        this._button = new Gtk.ColorDialogButton({ halign: Gtk.Align.CENTER });
        this._button.dialog = new Gtk.ColorDialog();
        this._apply();
        this.addContent(this._button);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._button) return;
        const rgba = Gdk.RGBA.parse(this.args.rgba as string);
        if (rgba !== null) this._button.rgba = rgba;
        this._button.dialog!.title = (this.args.title as string) || null;
    }
}

GObject.type_ensure(ColorDialogButtonStory.$gtype);

export const ColorDialogButtonStories: StoryModule = { stories: [ColorDialogButtonStory] };
