// Shared, renderer-agnostic metadata for the About Dialog story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const aboutDialogMeta: StoryMeta = {
    title: 'Feedback/About Dialog',
    description:
        'Adw.AboutDialog — the standard Adwaita about window with application name, version, credits and license.',
    controls: [
        {
            name: 'applicationName',
            label: 'Application name',
            type: ControlType.TEXT,
            defaultValue: 'Adwaita Storybook',
        },
        { name: 'version', label: 'Version', type: ControlType.TEXT, defaultValue: '0.11.0' },
    ],
};
