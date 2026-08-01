// Shared, renderer-agnostic metadata for the Button Row story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const buttonRowMeta: StoryMeta = {
    title: 'Boxed Lists/Button Row',
    description: 'Adw.ButtonRow — a full-width row that acts as a button, with an optional icon and style class.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Add account' },
        {
            name: 'startIconName',
            label: 'Start icon',
            type: ControlType.SELECT,
            options: [
                { label: 'Add', value: 'list-add-symbolic' },
                { label: 'Trash', value: 'user-trash-symbolic' },
                { label: 'None', value: '' },
            ],
            defaultValue: 'list-add-symbolic',
        },
        {
            name: 'style',
            label: 'Style',
            type: ControlType.SELECT,
            options: [
                { label: 'None', value: 'none' },
                { label: 'Suggested', value: 'suggested-action' },
                { label: 'Destructive', value: 'destructive-action' },
            ],
            defaultValue: 'suggested-action',
        },
    ],
};
