// Shared, renderer-agnostic metadata for the Clamp Scrollable story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const clampScrollableMeta: StoryMeta = {
    title: 'Layout/Clamp Scrollable',
    description:
        'Adw.ClampScrollable — a clamp whose child scrolls. The scrollbar stays at the edge of the window while ' +
        'the content is held at a maximum width.',
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
