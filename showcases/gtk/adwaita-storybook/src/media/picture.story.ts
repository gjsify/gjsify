// Gtk.Picture — an image fitted to the box, with the fit mode as the control.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import Gdk from 'gi://Gdk?version=4.0';
import GLib from 'gi://GLib?version=2.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { pictureMeta } from './picture.meta.js';

/** The story's paintable: a `Gdk.MemoryTexture` of two bands, so `contain` and `cover` differ. */
function makePaintable(): Gdk.Paintable {
    const width = 320;
    const height = 180;
    const stride = width * 4;
    const bytes = new Uint8Array(stride * height);
    for (let y = 0; y < height; y++) {
        // A horizontal split, so an axis-preserving fit and an axis-breaking one are
        // distinguishable at a glance — which is the whole point of a `content-fit` demo.
        const band = y < height / 2 ? 0x30 : 0x90;
        for (let x = 0; x < width; x++) {
            const offset = y * stride + x * 4;
            bytes[offset] = band;
            bytes[offset + 1] = x < width / 2 ? 0x40 : 0xc0;
            bytes[offset + 2] = 0xa0;
            bytes[offset + 3] = 0xff;
        }
    }
    return Gdk.MemoryTexture.new(width, height, Gdk.MemoryFormat.R8G8B8A8, GLib.Bytes.new(bytes), stride);
}

/** Story: a Gtk.Picture in a deliberately non-square box, so every fit mode is visible. */
export class PictureStory extends StoryWidget {
    private _picture: Gtk.Picture | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookPicture' }, PictureStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(PictureStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...pictureMeta, component: Gtk.Picture.$gtype };
    }

    initialize(): void {
        this._picture = new Gtk.Picture({
            paintable: makePaintable(),
            halign: Gtk.Align.CENTER,
            valign: Gtk.Align.CENTER,
        });
        this._apply();
        this.addContent(this._picture);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._picture) return;
        const width = this.args.width as number;
        // A 16:9 box round a 16:9 paintable, so `contain` fills it and `cover` does too —
        // which would hide the difference. The box is 3:2 so `cover` crops top and bottom.
        this._picture.set_size_request(width, Math.round((width * 2) / 3));
        // The ORDER is the C's: `keep_aspect_ratio` is a MAPPING onto `content_fit`
        // (gtkpicture.c:1017-1021), so writing it after `content_fit` would overwrite the
        // control the reader just moved. It goes FIRST, and only when it is on.
        if (this.args.keepAspectRatio as boolean) this._picture.keep_aspect_ratio = true;
        this._picture.content_fit = this.args.contentFit as Gtk.ContentFit;
        this._picture.can_shrink = this.args.canShrink as boolean;
        this._picture.alternative_text = this.args.alternativeText as string;
        this._picture.isolate_contents = this.args.isolateContents as boolean;
    }
}

GObject.type_ensure(PictureStory.$gtype);

export const PictureStories: StoryModule = { stories: [PictureStory] };
