// Gtk.MediaControls — the transport bar, shown with and without a stream.
// original implementation.

import Gtk from 'gi://Gtk?version=4.0';
import GObject from 'gi://GObject?version=2.0';
import { type StoryArgs, type StoryMeta, type StoryModule, StoryWidget } from '@gjsify/storybook';
import { mediaControlsMeta } from './media-controls.meta.js';

/** Story: a Gtk.MediaControls inside a `.osd .bottom` frame, as ui/gtkvideo.ui dresses it. */
export class MediaControlsStory extends StoryWidget {
    private _controls: Gtk.MediaControls | null = null;

    static {
        GObject.registerClass({ GTypeName: 'AdwStorybookMediaControls' }, MediaControlsStory);
    }

    constructor() {
        super(StoryWidget.fromMeta(MediaControlsStory.getMetadata(), 'Default'));
    }

    static getMetadata(): StoryMeta {
        return { ...mediaControlsMeta, component: Gtk.MediaControls.$gtype };
    }

    initialize(): void {
        this._controls = new Gtk.MediaControls();
        // The `.osd` and `.bottom` classes are what `ui/gtkvideo.ui` puts on the controls
        // revealer's child, and libadwaita has rules for exactly these (the `%osd` surface
        // and the 12px standalone-OSD-toolbar padding). The story wears them so the bar is
        // drawn as the video draws it rather than as a bare row of controls.
        this._controls.add_css_class('osd');
        this._controls.add_css_class('bottom');
        this._apply();
        this.addContent(this._controls);
    }

    updateArgs(_args: StoryArgs): void {
        this._apply();
    }

    private _apply(): void {
        if (!this._controls) return;
        // `sensitive` is the bar's WHOLE state, and the template ships it at 0
        // (ui/gtkmediacontrols.ui) — `gtk_media_controls_new()` gives a bar you cannot press.
        // The control flips it so a reader can see both halves of the widget's life.
        this._controls.sensitive = this.args.sensitive as boolean;
        // There is no `volume` line here and there cannot be: `Gtk.MediaControls` exposes no
        // volume setter, because `volume_adjustment` is private to the template
        // (`ui/gtkmediacontrols.ui`) and the button reads it directly. That is why the shared
        // meta declares no `volume` control either — one meta drives three panels, and a
        // control the browser alone could honour is what
        // `check-storybook-control-parity.mjs` refuses.
    }
}

GObject.type_ensure(MediaControlsStory.$gtype);

export const MediaControlsStories: StoryModule = { stories: [MediaControlsStory] };
