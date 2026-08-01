// Shared, renderer-agnostic metadata for the Wrap Box story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const wrapBoxMeta: StoryMeta = {
    title: 'Layout/Wrap Box',
    description: 'Adw.WrapBox flows its children horizontally and wraps them onto new lines when they run out of room.',
    controls: [
        {
            name: 'childSpacing',
            label: 'Child spacing',
            type: ControlType.RANGE,
            min: 0,
            max: 36,
            step: 1,
            defaultValue: 8,
        },
        {
            name: 'lineSpacing',
            label: 'Line spacing',
            type: ControlType.RANGE,
            min: 0,
            max: 36,
            step: 1,
            defaultValue: 8,
        },
    ],
};
