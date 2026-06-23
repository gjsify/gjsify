// Shared, renderer-agnostic metadata for the Action Row story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const actionRowMeta: StoryMeta = {
    title: 'Boxed Lists/Action Row',
    description:
        'Adw.ActionRow — a preferences row with a title/subtitle, a prefix icon and a suffix button, shown inside a boxed list.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Wi-Fi' },
        {
            name: 'subtitle',
            label: 'Subtitle',
            type: ControlType.TEXT,
            defaultValue: 'Connected to Highgarden 5GHz',
        },
        {
            name: 'iconName',
            label: 'Prefix icon',
            type: ControlType.SELECT,
            options: [
                { label: 'Network', value: 'network-wireless-symbolic' },
                { label: 'Folder', value: 'folder-symbolic' },
                { label: 'Starred', value: 'starred-symbolic' },
            ],
            defaultValue: 'network-wireless-symbolic',
        },
        { name: 'activatable', label: 'Activatable', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
