// Shared, renderer-agnostic metadata for the Clamp story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const clampMeta: StoryMeta = {
    title: 'Layout/Clamp',
    description:
        'Adw.Clamp limits its child to a maximum width and centres it, tightening the layout as space shrinks.',
    controls: [
        {
            name: 'maximumSize',
            label: 'Maximum size',
            type: ControlType.RANGE,
            min: 200,
            max: 600,
            step: 10,
            defaultValue: 400,
        },
        {
            name: 'tighteningThreshold',
            label: 'Tightening threshold',
            type: ControlType.RANGE,
            min: 100,
            max: 600,
            step: 10,
            defaultValue: 300,
        },
    ],
};
