// Shared, renderer-agnostic metadata for the Flow Box story. Imported by the GTK renderer
// (flow-box.story.ts) and the browser renderer (browser/presentation/flow-box.web.ts), so
// both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** The cells both renderings build — more than a full line, so the reflow is visible. */
export const FLOW_BOX_CELLS = ['Red', 'Orange', 'Yellow', 'Green', 'Blue', 'Purple', 'Teal', 'Grey'] as const;

/** The four `Gtk.SelectionMode` values, under the nicks the shared selection module uses. */
export const FLOW_BOX_SELECTION_MODES = [
    { label: 'Single', value: 'single' },
    { label: 'Multiple', value: 'multiple' },
    { label: 'Browse', value: 'browse' },
    { label: 'None', value: 'none' },
];

export const flowBoxMeta: StoryMeta = {
    title: 'Presentation/Flow Box',
    description:
        'Gtk.FlowBox — the same selectable rows a list box holds, reflowed into as many per line as the ' +
        'width fits. HORIZONTAL is the default here, unlike every GtkOrientable list base; the arrows move ' +
        'by visual position, so the cross-line key lands in the same column of the next line.',
    controls: [
        {
            name: 'selectionMode',
            label: 'Selection',
            type: ControlType.SELECT,
            options: FLOW_BOX_SELECTION_MODES,
            defaultValue: 'multiple',
        },
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
        {
            name: 'maxChildrenPerLine',
            label: 'Max children per line',
            type: ControlType.NUMBER,
            defaultValue: 3,
        },
        { name: 'homogeneous', label: 'Homogeneous', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'rowSpacing', label: 'Row spacing', type: ControlType.NUMBER, defaultValue: 6 },
    ],
};
