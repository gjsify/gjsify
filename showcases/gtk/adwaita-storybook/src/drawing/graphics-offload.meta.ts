// Shared, renderer-agnostic metadata for the Graphics Offload story. Imported by the GTK
// renderer (graphics-offload.story.ts) and the browser renderer
// (browser/drawing/graphics-offload.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const graphicsOffloadMeta: StoryMeta = {
    title: 'Drawing/Graphics Offload',
    description:
        'Gtk.GraphicsOffload — a wrapper that asks the compositor to take its ONE child as it is, which ' +
        'is worth doing for content that changes every frame. `enabled` says whether it is attempted, and ' +
        "`black-background` paints the letterbox bars. The passthrough itself is the platform's: no browser " +
        'API hands a surface to a compositor, so the replica carries the enum, the black rectangle and the ' +
        'bin layout, and says plainly which part is missing.',
    controls: [
        {
            name: 'enabled',
            label: 'Enabled',
            type: ControlType.SELECT,
            options: [
                { label: 'Enabled (default)', value: 'enabled' },
                { label: 'Disabled', value: 'disabled' },
            ],
            defaultValue: 'enabled',
        },
        { name: 'blackBackground', label: 'Black background', type: ControlType.BOOLEAN, defaultValue: false },
        {
            name: 'child',
            label: 'Child',
            type: ControlType.SELECT,
            options: [
                { label: 'Label', value: 'label' },
                { label: 'Image', value: 'image' },
                { label: 'Row of labels', value: 'box' },
            ],
            defaultValue: 'image',
        },
    ],
};
