// Shared, renderer-agnostic metadata for the Expander Row story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const expanderRowMeta: StoryMeta = {
    title: 'Boxed Lists/Expander Row',
    description:
        'Adw.ExpanderRow — a preferences row that discloses nested rows and can carry an enable switch.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Proxy settings' },
        {
            name: 'subtitle',
            label: 'Subtitle',
            type: ControlType.TEXT,
            defaultValue: 'Route traffic through a custom proxy',
        },
        { name: 'expanded', label: 'Expanded', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'showEnableSwitch',
            label: 'Show enable switch',
            type: ControlType.BOOLEAN,
            defaultValue: false,
        },
    ],
};
