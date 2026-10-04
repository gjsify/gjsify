// Shared, renderer-agnostic metadata for the Scale Button story. Imported by the GTK
// renderer (scale-button.story.ts) and the browser renderer
// (browser/buttons/scale-button.web.ts), so both expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

/** The icon list every renderer binds: three names, so the value picks between them. */
export const SCALE_BUTTON_ICONS = [
    'audio-volume-muted-symbolic',
    'audio-volume-low-symbolic',
    'audio-volume-high-symbolic',
];

export const scaleButtonMeta: StoryMeta = {
    title: 'Buttons/Scale Button',
    description:
        'Gtk.ScaleButton — a button whose press opens a scale. The icon follows the value: no list ' +
        'draws image-missing, one name is used throughout, two split the range, three put the first at ' +
        'the bottom and the second at the top and share the interior, five spread it.',
    controls: [
        { name: 'value', label: 'Value', type: ControlType.NUMBER, defaultValue: 70 },
        {
            name: 'orientation',
            label: 'Orientation',
            type: ControlType.SELECT,
            options: [
                { label: 'Vertical', value: 'vertical' },
                { label: 'Horizontal', value: 'horizontal' },
            ],
            defaultValue: 'vertical',
        },
        { name: 'hasFrame', label: 'Has frame', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
