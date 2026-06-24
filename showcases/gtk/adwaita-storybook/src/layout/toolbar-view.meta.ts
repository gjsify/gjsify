// Shared, renderer-agnostic metadata for the Toolbar View story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const toolbarViewMeta: StoryMeta = {
    title: 'Layout/Toolbar View',
    description:
        'Adw.ToolbarView pins a top header bar and a bottom toolbar around its content, each independently revealable.',
    controls: [
        { name: 'revealTopBars', label: 'Reveal top bars', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'revealBottomBars',
            label: 'Reveal bottom bars',
            type: ControlType.BOOLEAN,
            defaultValue: true,
        },
    ],
};
