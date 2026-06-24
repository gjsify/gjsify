// Shared, renderer-agnostic metadata for the Sidebar story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const sidebarMeta: StoryMeta = {
    title: 'Navigation/Sidebar',
    description:
        'Adw.Sidebar — a selectable list of Adw.SidebarItem grouped into sections. Selecting an item updates the content.',
    controls: [
        {
            name: 'mode',
            label: 'Mode',
            type: ControlType.SELECT,
            options: [
                { label: 'Sidebar', value: 'sidebar' },
                { label: 'Page', value: 'page' },
            ],
            defaultValue: 'sidebar',
        },
        {
            name: 'selected',
            label: 'Selected index',
            type: ControlType.NUMBER,
            min: 0,
            max: 3,
            step: 1,
            defaultValue: 0,
        },
    ],
};
