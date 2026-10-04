// Browser port of the Media Controls story. Shares metadata with media-controls.story.ts.

import { StoryElement, type StoryArgs, type StoryMeta, type WebStoryModule } from '@gjsify/adwaita-storybook';
import { mediaControlsMeta } from '../../media/media-controls.meta.js';

/**
 * The element's public surface, as the story needs it. `volume` is a real property HERE and
 * has no counterpart in GTK: `volume_adjustment` is private to the template
 * (`ui/gtkmediacontrols.ui`) and `Gtk.MediaControls` exposes no volume setter, which is why
 * no `volume` CONTROL is declared in the shared meta — one meta drives three panels, so a
 * control only the browser could honour is refused by `check-storybook-control-parity.mjs`.
 */
type MediaControlsElement = HTMLElement & { volume: number };

export class MediaControlsWebStory extends StoryElement {
    private _video: HTMLElement | null = null;
    private _controls: MediaControlsElement | null = null;
    private _media: HTMLVideoElement | null = null;

    constructor() {
        super(MediaControlsWebStory.getMetadata(), 'Default');
    }

    static getMetadata(): StoryMeta {
        return mediaControlsMeta;
    }

    initialize(): void {
        // The controls bar lives INSIDE the video, as `ui/gtkvideo.ui`'s controls revealer
        // does, and it adopts its stream from the nearest ancestor video — that is how the
        // element finds the `<video>` to drive.
        this._video = document.createElement('gtk-video');
        this._controls = document.createElement('gtk-media-controls') as MediaControlsElement;
        this._media = document.createElement('video');
        this._media.muted = true;
        this._video.append(this._media, this._controls);
        this._apply();
        this.addContent(this._video);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._video || !this._controls) return;
        this._video.style.width = '360px';
        this._video.style.height = '203px';
        // GTK's bar is the video's own controls revealer child and the video itself is the
        // anchor, so the bar is given the same width as the surface above it.
        this._controls.style.display = 'block';
        // `sensitive` is the control the meta declares, and the element's own spelling is the
        // template's: the box ships `sensitive` 0 (ui/gtkmediacontrols.ui) and
        // `gtk_media_controls_set_sensitive` is what re-enables it. Here it is the `insensitive`
        // CLASS the stylesheet selects on, set from the normalized property — an attribute
        // presence selector could be left half-applied by a value the element did not take.
        this._controls.classList.toggle('insensitive', !(this.args.sensitive as boolean));
        // `volume` is set once and never from a control: the meta declares none, because GTK
        // cannot honour one. A reader who wants to see the four `audio-volume-*` names move
        // reaches the element's property directly, which is where the divergence lives.
        this._controls.volume = 1;
    }
}

export const MediaControlsWebStories: WebStoryModule = { stories: [MediaControlsWebStory] };
