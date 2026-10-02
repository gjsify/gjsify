// Gtk.Image — the symbolic icon node, sized by the reader.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { imageMeta } from './image.meta.js';

/** Story: one Gtk.Image at the reader's size, with the name as the control. */
export class ImageStory extends StoryWidget {
    private _image: Gtk.Image | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookImage' }, ImageStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(ImageStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...imageMeta, component: Gtk.Image.$gtype };
    }

    initialize(): void {
        this._image = new Gtk.Image({ halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._image);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._image) return;
        // `icon_size` is GTK's own ICON_SIZE enum, and a widget's measurement is made from the
        // minimum AND the natural size of that enum (gtkspinner.c:110-123 is the same shape),
        // so the size request is what actually grows the box.
        this._image.icon_size = this.args.size as number as Gtk.IconSize;
        this._image.icon_name = this.args.iconName as string;
        this._image.sensitive = !(this.args.disabled as boolean);
    }
}

GObject.type_ensure(ImageStory.$gtype);

export const ImageStories: StoryModule = { stories: [ImageStory] };
