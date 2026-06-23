// Shared, renderer-agnostic metadata for the Banner story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const bannerMeta: StoryMeta = {
    title: 'Presentation/Banner',
    description: 'Adw.Banner — a full-width strip carrying a status message and an optional action button.',
    controls: [
        {
            name: 'title',
            label: 'Title',
            type: ControlType.TEXT,
            defaultValue: 'Metered connection — updates paused',
        },
        { name: 'buttonLabel', label: 'Button label', type: ControlType.TEXT, defaultValue: 'Resume' },
        { name: 'revealed', label: 'Revealed', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'useMarkup', label: 'Use markup', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
