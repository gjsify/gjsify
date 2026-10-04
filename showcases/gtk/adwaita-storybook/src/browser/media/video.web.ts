// Browser port of the Video story. Shares metadata with video.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { videoMeta } from '../../media/video.meta.js';

/** The element's public surface, as the story needs it — the attrs are the properties. */
type VideoElement = HTMLElement & {
    revealControls(): void;
};

export class VideoWebStory extends StoryElement {
    private _video: VideoElement | null = null;
    private _media: HTMLVideoElement | null = null;

    constructor() {
        super(VideoWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return videoMeta;
    }

    initialize(): void {
        this._video = document.createElement('gtk-video') as VideoElement;
        // A real `<video>` with NO source, which is the browser's version of the state the GTK
        // story shows: `gtk_video_update_overlay_icon`'s FIRST arm is "no stream"
        // (gtkvideo.c:629), and a `<video>` with no `src` has a `networkState` of NETWORK_EMPTY,
        // so the element cannot tell the two apart and draws the same eject glyph. The story
        // that could load a real clip would prove nothing extra about the WIDGET.
        this._media = document.createElement('video');
        this._media.muted = true;
        this._video.appendChild(this._media);
        this._apply();
        this.addContent(this._video);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._video) return;
        const width = String(this.args.width as number);
        this._video.style.width = `${width}px`;
        this._video.style.height = `${Math.round((Number(width) * 9) / 16)}px`;
        this._video.toggleAttribute('autoplay', this.args.autoplay as boolean);
        this._video.toggleAttribute('loop', this.args.loop as boolean);
        this._video.toggleAttribute('graphics-offload', this.args.graphicsOffload as boolean);
        // The controls bar reveals on pointer movement in GTK (ui/gtkvideo.ui's
        // `gtk_video_motion`), and a story the reader cannot see the bar in is a story that
        // documents nothing — so the first reveal is explicit rather than waited for.
        this._video.revealControls();
    }
}

export const VideoWebStories: WebStoryModule = { stories: [VideoWebStory] };
