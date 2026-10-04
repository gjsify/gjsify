// Shared, renderer-agnostic metadata for the Window story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const windowMeta: StoryMeta = {
    title: 'Layout/Window',
    description:
        'Adw.Window — a freeform window with no titlebar area. Use Adw.ToolbarView with Adw.HeaderBar for the top chrome.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Text Editor' },
        { name: 'subtitle', label: 'Subtitle', type: ControlType.TEXT, defaultValue: 'notes.md' },
    ],
};
