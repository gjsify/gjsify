// Shared, renderer-agnostic metadata for the Scale story. Imported by the GTK
// renderer (scale.story.ts) and the browser renderer (browser/controls/scale.web.ts),
// so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const scaleMeta: StoryMeta = {
    title: 'Controls/Scale',
    description:
        'Gtk.Scale — a slider. Gtk.Scale extends Gtk.Range, which is abstract: the range itself has no tag, ' +
        'its adjustment, value, inverted and fill level are this widget’s properties. draw-value shows the ' +
        'number beside the knob at the value-pos you name, and the .value style class dims it.',
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
        {
            name: 'valuePos',
            label: 'Value position',
            type: ControlType.SELECT,
            options: [
                { label: 'Top', value: 'top' },
                { label: 'Bottom', value: 'bottom' },
                { label: 'Left', value: 'left' },
                { label: 'Right', value: 'right' },
            ],
            defaultValue: 'top',
        },
        { name: 'drawValue', label: 'Draw value', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'digits', label: 'Digits', type: ControlType.NUMBER, defaultValue: 0 },
        { name: 'inverted', label: 'Inverted', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'hasOrigin', label: 'Has origin', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'value',
            label: 'Value',
            type: ControlType.NUMBER,
            defaultValue: 40,
        },
    ],
};
