// Shared, renderer-agnostic metadata for the Header Bar story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const headerBarMeta: StoryMeta = {
    title: 'Layout/Header Bar',
    description:
        'Adw.HeaderBar hosts a custom title widget with start and end controls — the standard top chrome of an Adwaita window.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Text Editor' },
        { name: 'subtitle', label: 'Subtitle', type: ControlType.TEXT, defaultValue: 'notes.md' },
        { name: 'showTitle', label: 'Show title', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
