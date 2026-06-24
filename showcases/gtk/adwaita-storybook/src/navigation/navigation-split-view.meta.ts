// Shared, renderer-agnostic metadata for the Navigation Split View story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const navigationSplitViewMeta: StoryMeta = {
    title: 'Navigation/Navigation Split View',
    description:
        'Adw.NavigationSplitView — a resizable sidebar beside a content pane. When collapsed it folds into a navigation stack.',
    controls: [
        { name: 'showContent', label: 'Show content', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'collapsed', label: 'Collapsed', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
