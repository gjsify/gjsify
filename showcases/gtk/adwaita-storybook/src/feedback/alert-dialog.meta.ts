// Shared, renderer-agnostic metadata for the Alert Dialog story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const alertDialogMeta: StoryMeta = {
    title: 'Feedback/Alert Dialog',
    description:
        'Adw.AlertDialog — a modal dialog with a heading, body text and responses, including a destructive action.',
    controls: [
        { name: 'heading', label: 'Heading', type: ControlType.TEXT, defaultValue: 'Delete Project?' },
        {
            name: 'body',
            label: 'Body',
            type: ControlType.TEXT,
            defaultValue:
                'This will permanently remove the project and all of its files. This action cannot be undone.',
        },
    ],
};
