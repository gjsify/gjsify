// Shared, renderer-agnostic metadata for the Spin Row story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const spinRowMeta: StoryMeta = {
    title: 'Boxed Lists/Spin Row',
    description: 'Adw.SpinRow — a preferences row with an inline spin button over a numeric adjustment.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Font size' },
        {
            name: 'value',
            label: 'Value',
            type: ControlType.NUMBER,
            min: 0,
            max: 100,
            step: 1,
            defaultValue: 16,
        },
        {
            name: 'digits',
            label: 'Digits',
            type: ControlType.NUMBER,
            min: 0,
            max: 4,
            step: 1,
            defaultValue: 0,
        },
    ],
};
