// Shared, renderer-agnostic metadata for the Paned story. Imported by the GTK renderer
// (paned.story.ts) and the browser renderer (browser/layout/paned.web.ts), so both expose
// identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const panedMeta: StoryMeta = {
    title: 'Layout/Paned',
    description:
        'Gtk.Paned — two children either side of a divider the user drags. With both children ' +
        'resizable and no position set, GTK divides the paned in PROPORTION TO THE TWO SIZE ' +
        'REQUESTS rather than in half, and it draws the divider as the `separator` node a ' +
        'GtkPanedHandle carries. Libadwaita styles that node in _paned.scss: 1px, 5px when ' +
        '`wide-handle`, with the rule as an inset shadow rather than a fill.',
    controls: [
        {
            name: 'orientation',
            label: 'Orientation',
            type: ControlType.SELECT,
            options: [
                { label: 'Horizontal', value: 'horizontal' },
                { label: 'Vertical', value: 'vertical' },
            ],
            defaultValue: 'horizontal',
        },
        { name: 'wideHandle', label: 'Wide handle', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'resizeStartChild', label: 'Resize the first child', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'resizeEndChild', label: 'Resize the second child', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'shrinkStartChild',
            label: 'The first child may shrink',
            type: ControlType.BOOLEAN,
            defaultValue: true,
        },
        {
            name: 'position',
            label: 'Position (0 = derive)',
            type: ControlType.NUMBER,
            min: -1,
            max: 400,
            step: 1,
            defaultValue: -1,
        },
    ],
};
