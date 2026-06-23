// Shared, renderer-agnostic metadata for the Window Title story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const windowTitleMeta: StoryMeta = {
    title: 'Presentation/Window Title',
    description: 'Adw.WindowTitle — a compact title/subtitle widget intended for a window or header bar.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Inbox' },
        { name: 'subtitle', label: 'Subtitle', type: ControlType.TEXT, defaultValue: '3 unread messages' },
    ],
};
