// Shared, renderer-agnostic metadata for the Frame story. Imported by the GTK
// renderer (frame.story.ts) and the browser renderer (browser/layout/frame.web.ts),
// so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const frameMeta: StoryMeta = {
    title: 'Layout/Frame',
    description:
        'Gtk.Frame — a 1px border with a label embedded in its top edge. GTK draws the label as its own ' +
        'widget above the child, and label-xalign says where across the frame it sits.',
    controls: [
        { name: 'label', label: 'Label', type: ControlType.TEXT, defaultValue: 'Details' },
        {
            name: 'labelXalign',
            label: 'Label xalign',
            type: ControlType.RANGE,
            defaultValue: 0,
            min: 0,
            max: 1,
            step: 0.5,
        },
    ],
};
