// Shared, renderer-agnostic metadata for the Status Page story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const statusPageMeta: StoryMeta = {
    title: 'Presentation/Status Page',
    description: 'Adw.StatusPage — a full-page empty state with an icon, title, description and optional action.',
    controls: [
        {
            name: 'iconName',
            label: 'Icon',
            type: ControlType.SELECT,
            options: [
                { label: 'Folder', value: 'folder-symbolic' },
                { label: 'Mail', value: 'mail-unread-symbolic' },
                { label: 'Search', value: 'system-search-symbolic' },
                { label: 'Star', value: 'starred-symbolic' },
            ],
            defaultValue: 'folder-symbolic',
        },
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'No Documents' },
        {
            name: 'description',
            label: 'Description',
            type: ControlType.TEXT,
            defaultValue: 'Documents you create or open will appear here.',
        },
    ],
};
