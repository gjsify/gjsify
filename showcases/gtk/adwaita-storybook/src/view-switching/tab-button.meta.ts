// Shared, renderer-agnostic metadata for the Tab Button story.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const tabButtonMeta: StoryMeta = {
    title: 'View Switching/Tab Button',
    description:
        'Adw.TabButton — a button that shows how many pages an Adw.TabView holds, and a dot when a page you are ' +
        'not looking at needs attention. From ten pages the number shrinks; at a hundred it becomes a glyph.',
    controls: [
        { name: 'pages', label: 'Pages', type: ControlType.RANGE, min: 0, max: 100, step: 1, defaultValue: 3 },
        { name: 'needsAttention', label: 'Last page needs attention', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
