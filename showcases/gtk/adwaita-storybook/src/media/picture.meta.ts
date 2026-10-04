// Shared, renderer-agnostic metadata for the Picture story. Imported by the GTK
// renderer (picture.story.ts) and the browser renderer (browser/media/picture.web.ts),
// so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const pictureMeta: StoryMeta = {
    title: 'Media/Picture',
    description:
        'Gtk.Picture — an image fitted to the box it is given, not sized by itself. `content-fit` picks one ' +
        'of the four fit modes (contain, cover, fill, scale-down), `can-shrink` decides whether it may be ' +
        'smaller than its content, and `alternative-text` is what a screen reader hears.',
    controls: [
        {
            name: 'contentFit',
            label: 'Content fit',
            type: ControlType.SELECT,
            options: [
                { label: 'Contain', value: 'contain' },
                { label: 'Cover', value: 'cover' },
                { label: 'Fill', value: 'fill' },
                { label: 'Scale down', value: 'scale-down' },
            ],
            defaultValue: 'contain',
        },
        { name: 'canShrink', label: 'Can shrink', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'alternativeText',
            label: 'Alternative text',
            type: ControlType.TEXT,
            defaultValue: 'A tangerine',
        },
        { name: 'isolateContents', label: 'Isolate contents', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'keepAspectRatio',
            label: 'Keep aspect ratio (deprecated)',
            type: ControlType.BOOLEAN,
            defaultValue: true,
        },
        { name: 'width', label: 'Width (px)', type: ControlType.RANGE, min: 64, max: 320, step: 16, defaultValue: 240 },
    ],
};
