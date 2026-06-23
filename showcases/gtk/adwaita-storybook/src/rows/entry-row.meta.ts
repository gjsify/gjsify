// Shared, renderer-agnostic metadata for the Entry Row story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const entryRowMeta: StoryMeta = {
    title: 'Boxed Lists/Entry Row',
    description: 'Adw.EntryRow — a preferences row whose title doubles as placeholder text for an inline entry.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'Display name' },
        { name: 'text', label: 'Text', type: ControlType.TEXT, defaultValue: 'Ada Lovelace' },
        { name: 'showApplyButton', label: 'Show apply button', type: ControlType.BOOLEAN, defaultValue: true },
    ],
};
