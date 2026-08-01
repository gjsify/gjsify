// Shared, renderer-agnostic metadata for the Overlay Split View story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const overlaySplitViewMeta: StoryMeta = {
    title: 'Navigation/Overlay Split View',
    description: 'Adw.OverlaySplitView — a sidebar shown beside the content, or overlaid on top of it when collapsed.',
    controls: [
        { name: 'showSidebar', label: 'Show sidebar', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'collapsed', label: 'Collapsed', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
