// Shared, renderer-agnostic metadata for the Preferences Dialog story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const preferencesDialogMeta: StoryMeta = {
    title: 'Feedback/Preferences Dialog',
    description: 'Adw.PreferencesDialog — a preferences window with a page, a group and a handful of boxed-list rows.',
    controls: [
        { name: 'pageTitle', label: 'Page title', type: ControlType.TEXT, defaultValue: 'General' },
        { name: 'groupTitle', label: 'Group title', type: ControlType.TEXT, defaultValue: 'Appearance' },
    ],
};
