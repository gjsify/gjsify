// Shared, renderer-agnostic metadata for the Switch Row story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const switchRowMeta: StoryMeta = {
    title: 'Boxed Lists/Switch Row',
    description: 'Adw.SwitchRow — a preferences row with a trailing switch, shown inside a boxed list.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Automatic updates' },
        {
            name: 'subtitle',
            label: 'Subtitle',
            type: ControlType.TEXT,
            defaultValue: 'Download and install updates without asking',
        },
        { name: 'active', label: 'Active', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
