// Shared, renderer-agnostic metadata for the Preferences Row story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const preferencesRowMeta: StoryMeta = {
    title: 'Boxed Lists/Preferences Row',
    description:
        'Adw.PreferencesRow — the base of every boxed-list row: a list row with a title that the preferences ' +
        'dialog searches. The title can carry Pango markup and be made selectable.',
    controls: [
        { name: 'title', label: 'Title', type: ControlType.TEXT, defaultValue: 'A <b>plain</b> preferences row' },
        { name: 'useMarkup', label: 'Use markup', type: ControlType.BOOLEAN, defaultValue: true },
        { name: 'titleSelectable', label: 'Title selectable', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
