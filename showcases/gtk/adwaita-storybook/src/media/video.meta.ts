// Shared, renderer-agnostic metadata for the Video story. Imported by the GTK
// renderer (video.story.ts) and the browser renderer (browser/media/video.web.ts),
// so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const videoMeta: StoryMeta = {
    title: 'Media/Video',
    description:
        'Gtk.Video — a play surface with an overlay icon and a controls bar that hides itself three seconds ' +
        'after you stop moving the pointer. The overlay icon is a four-way choice — no stream, error, ended, ' +
        'or ready — and it is only VISIBLE while the video is stopped; there is no pause glyph over the frames.',
    controls: [
        { name: 'autoplay', label: 'Autoplay', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'loop', label: 'Loop', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'graphicsOffload',
            label: 'Graphics offload',
            type: ControlType.BOOLEAN,
            defaultValue: false,
        },
        {
            name: 'width',
            label: 'Width (px)',
            type: ControlType.RANGE,
            min: 160,
            max: 480,
            step: 40,
            defaultValue: 320,
        },
    ],
};
