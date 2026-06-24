// Shared, renderer-agnostic metadata for the Navigation View story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const navigationViewMeta: StoryMeta = {
    title: 'Navigation/Navigation View',
    description:
        'Adw.NavigationView — a navigation stack. The root page pushes a detail page, which gets an automatic back button.',
    controls: [
        { name: 'rootTitle', label: 'Root title', type: ControlType.TEXT, defaultValue: 'Contacts' },
        { name: 'detailTitle', label: 'Detail title', type: ControlType.TEXT, defaultValue: 'Ada Lovelace' },
        {
            name: 'animateTransitions',
            label: 'Animate transitions',
            type: ControlType.BOOLEAN,
            defaultValue: true,
        },
    ],
};
