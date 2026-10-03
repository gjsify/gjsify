// Shared, renderer-agnostic metadata for the Center Box story. Imported by the GTK
// renderer (center-box.story.ts) and the browser renderer
// (browser/layout/center-box.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const centerBoxMeta: StoryMeta = {
    title: 'Layout/Center Box',
    description:
        'Gtk.CenterBox — three widgets, pinned to the start, the centre and the end, with the space between ' +
        'them going to whichever child can grow. shrink-center-last decides who gives up space first.',
    controls: [
        { name: 'shrinkCenterLast', label: 'Shrink center last', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'baselinePosition',
            label: 'Baseline position',
            type: ControlType.SELECT,
            options: [
                { label: 'Top', value: 'top' },
                { label: 'Center', value: 'center' },
                { label: 'Bottom', value: 'bottom' },
            ],
            defaultValue: 'center',
        },
    ],
};
