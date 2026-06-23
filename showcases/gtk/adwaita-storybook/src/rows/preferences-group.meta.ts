// Shared, renderer-agnostic metadata for the Preferences Group story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const preferencesGroupMeta: StoryMeta = {
    title: 'Boxed Lists/Preferences Group',
    description:
        'Adw.PreferencesGroup — the boxed-list container that gathers a title, description, header-suffix widget and rows.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Account' },
        {
            name: 'description',
            label: 'Description',
            type: ControlType.TEXT,
            defaultValue: 'Manage how this device signs in and syncs.',
        },
    ],
};
