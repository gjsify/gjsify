// Shared, renderer-agnostic metadata for the Level Bar story. Imported by the GTK
// renderer (level-bar.story.ts) and the browser renderer
// (browser/controls/level-bar.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const levelBarMeta: StoryMeta = {
    title: 'Controls/Level Bar',
    description:
        'Gtk.LevelBar — how full something is, over an interval that need not be 0…1: a password ' +
        'strength meter, a battery. `mode` decides one filled level or one block per unit, and the ' +
        'block takes a class from the nearest OFFSET (low, high, full by default), which is how libadwaita ' +
        'colours it and how an application adds a colour of its own.',
    controls: [
        { name: 'value', label: 'Value', type: ControlType.RANGE, min: 0, max: 1, step: 0.05, defaultValue: 0.8 },
        { name: 'maxValue', label: 'Max value', type: ControlType.RANGE, min: 1, max: 5, step: 1, defaultValue: 5 },
        {
            name: 'mode',
            label: 'Mode',
            type: ControlType.SELECT,
            options: [
                { label: 'Continuous', value: 'continuous' },
                { label: 'Discrete', value: 'discrete' },
            ],
            defaultValue: 'continuous',
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
        { name: 'inverted', label: 'Inverted', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
