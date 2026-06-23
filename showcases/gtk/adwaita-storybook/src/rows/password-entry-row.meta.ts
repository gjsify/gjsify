// Shared, renderer-agnostic metadata for the Password Entry Row story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const passwordEntryRowMeta: StoryMeta = {
    title: 'Boxed Lists/Password Entry Row',
    description: 'Adw.PasswordEntryRow — an entry row that masks its contents and shows a peek toggle.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Password' },
        { name: 'text', label: 'Text', type: ControlType.TEXT, defaultValue: 'correct-horse-battery' },
    ],
};
