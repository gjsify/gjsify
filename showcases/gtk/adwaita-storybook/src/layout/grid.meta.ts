// Shared, renderer-agnostic metadata for the Grid story. Imported by the GTK
// renderer (grid.story.ts) and the browser renderer (browser/layout/grid.web.ts),
// so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const gridMeta: StoryMeta = {
    title: 'Layout/Grid',
    description:
        'Gtk.Grid — a table of cells sized by what is in them, filled row by row. The two spacings are the ' +
        'gap between lines, the two homogeneous flags make every line the same, and a vertical grid attaches ' +
        'down the rows instead of across the columns.',
    controls: [
        {
            name: 'columnSpacing',
            label: 'Column spacing',
            type: ControlType.RANGE,
            min: 0,
            max: 36,
            step: 2,
            defaultValue: 12,
        },
        {
            name: 'rowSpacing',
            label: 'Row spacing',
            type: ControlType.RANGE,
            min: 0,
            max: 36,
            step: 2,
            defaultValue: 12,
        },
        { name: 'columnHomogeneous', label: 'Column homogeneous', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'rowHomogeneous', label: 'Row homogeneous', type: ControlType.BOOLEAN, defaultValue: false },
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
    ],
};
