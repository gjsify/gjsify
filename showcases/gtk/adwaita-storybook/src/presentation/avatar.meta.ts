// Shared, renderer-agnostic metadata for the Avatar story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const avatarMeta: StoryMeta = {
    title: 'Presentation/Avatar',
    description: 'A circular avatar that derives initials (and a colour) from a name, or shows a symbolic icon.',
    controls: [
        { name: 'text', label: 'Name', type: ControlType.TEXT, defaultValue: 'Ada Lovelace' },
        { name: 'size', label: 'Size', type: ControlType.RANGE, min: 24, max: 160, step: 8, defaultValue: 96 },
        { name: 'showInitials', label: 'Show initials', type: ControlType.BOOLEAN, defaultValue: true },
        {
            name: 'iconName',
            label: 'Fallback icon',
            type: ControlType.SELECT,
            options: [
                { label: 'Person', value: 'avatar-default-symbolic' },
                { label: 'Contact', value: 'contact-new-symbolic' },
                { label: 'Camera', value: 'camera-photo-symbolic' },
            ],
            defaultValue: 'avatar-default-symbolic',
        },
    ],
};
