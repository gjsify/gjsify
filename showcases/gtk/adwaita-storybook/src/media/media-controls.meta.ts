// Shared, renderer-agnostic metadata for the Media Controls story. Imported by the GTK
// renderer (media-controls.story.ts) and the browser renderer
// (browser/media/media-controls.web.ts), so both expose identical controls.
//
// The NAME is `media-controls` and not `controls`: the storybook keys every meta on its
// file name, and `bareName('Gtk.MediaControls')` in
// `scripts/check-website-adwaita-gallery.mjs` derives the same spelling — so the block on
// /gjsify/gtk/media/ is found from this file without a TITLED_AFTER entry.

import { ControlType, type StoryMeta } from '@gjsify/stories';

// ONE control, and the omission is the decision. `sensitive` is the whole of the widget's
// API beyond its one object property — `gtk_media_controls_set_sensitive` — and it is what
// both renderings bind.
//
// `volume` used to sit here beside it and does not, because it would have moved on the
// browser and done NOTHING on GTK: `volume_adjustment` is private to the template
// (`ui/gtkmediacontrols.ui`) and `Gtk.MediaControls` exposes no volume setter at all. One
// meta drives three panels, so a control one of them cannot honour is precisely the shape
// `check-storybook-control-parity.mjs` exists to refuse. The browser element's `volume`
// property is real and its own, and the doc says so.
export const mediaControlsMeta: StoryMeta = {
    title: 'Media/Media Controls',
    description:
        'Gtk.MediaControls — the transport bar: play, position, duration, volume. It owns no playback at all ' +
        '(its one property is an object, `media-stream`), and the bar is INSENSITIVE until a stream is ' +
        'attached. Note which label shows what: the position label shows the elapsed time and the one beside ' +
        'it shows what REMAINS, negatively.',
    controls: [{ name: 'sensitive', label: 'Sensitive', type: ControlType.BOOLEAN, defaultValue: true }],
};
