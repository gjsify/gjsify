// Gtk.Video — a play surface with an overlay and a self-hiding controls bar.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { videoMeta } from './video.meta.js';

/** Story: a Gtk.Video at the reader's width, with no stream attached. */
export class VideoStory extends StoryWidget {
    private _video: Gtk.Video | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookVideo' }, VideoStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(VideoStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...videoMeta, component: Gtk.Video.$gtype };
    }

    initialize(): void {
        // NO `set_media_stream`. A stream needs a backend behind it — gstreamer — and the
        // overlay's first arm is the one a stream-less video shows anyway: `media-eject` is
        // what `gtk_video_update_overlay_icon` draws when there is no stream at all
        // (gtkvideo.c:629). So the story shows the state every GtkVideo starts in, which is
        // the state a browser's `<video>` cannot reach.
        this._video = new Gtk.Video({ halign: Gtk.Align.CENTER, valign: Gtk.Align.CENTER });
        this._apply();
        this.addContent(this._video);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._video) return;
        const width = this.args.width as number;
        this._video.set_size_request(width, Math.round((width * 9) / 16));
        this._video.autoplay = this.args.autoplay as boolean;
        this._video.loop = this.args.loop as boolean;
        // Graphics offload is a rendering hint with no visible effect until something is
        // actually drawn, so this control exists to show that the property takes the write
        // rather than to show a difference.
        this._video.graphics_offload = this.args.graphicsOffload
            ? Gtk.GraphicsOffloadEnabled.ENABLED
            : Gtk.GraphicsOffloadEnabled.DISABLED;
    }
}

GObject.type_ensure(VideoStory.$gtype);

export const VideoStories: StoryModule = { stories: [VideoStory] };
