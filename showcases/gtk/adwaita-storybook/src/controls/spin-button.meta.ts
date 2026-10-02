// Shared, renderer-agnostic metadata for the Spin Button story. Imported by the GTK
// renderer (spin-button.story.ts) and the browser renderer
// (browser/controls/spin-button.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const spinButtonMeta: StoryMeta = {
    title: 'Controls/Spin Button',
    description:
        'Gtk.SpinButton — a number field with an arrow either side of it. The range is a Gtk.Adjustment, the ' +
        'typed value is clamped into it (or left alone, under update-policy if-valid), and numeric refuses ' +
        'anything that is not a number. Adw.SpinRow is the boxed-list row that wraps this same widget.',
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
        { name: 'digits', label: 'Digits', type: ControlType.NUMBER, defaultValue: 0 },
        { name: 'numeric', label: 'Numeric', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'snapToTicks', label: 'Snap to ticks', type: ControlType.BOOLEAN, defaultValue: false },
        { name: 'wrap', label: 'Wrap', type: ControlType.BOOLEAN, defaultValue: false },
        {
            name: 'updatePolicy',
            label: 'Update policy',
            type: ControlType.SELECT,
            options: [
                { label: 'Always', value: 'always' },
                { label: 'If valid', value: 'if-valid' },
            ],
            defaultValue: 'always',
        },
        { name: 'value', label: 'Value', type: ControlType.NUMBER, defaultValue: 5 },
    ],
};
