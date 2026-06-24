// Shared, renderer-agnostic metadata for the Toast story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const toastMeta: StoryMeta = {
    title: 'Feedback/Toast',
    description:
        'Adw.Toast — a transient notification, with an optional action button, shown over an Adw.ToastOverlay.',
    controls: [
        { name: 'title', label: 'Toast text', type: ControlType.TEXT, defaultValue: 'File moved to Trash' },
        {
            name: 'timeout',
            label: 'Timeout (s)',
            type: ControlType.NUMBER,
            min: 0,
            max: 10,
            step: 1,
            defaultValue: 3,
        },
        { name: 'hasButton', label: 'Action button', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'buttonLabel', label: 'Button label', type: ControlType.TEXT, defaultValue: 'Undo' },
    ],
};
