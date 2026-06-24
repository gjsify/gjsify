// Shared, renderer-agnostic metadata for the View Switcher story. Imported by
// both the GTK renderer (view-switcher.story.ts) and the browser renderer
// (browser/view-switching/view-switcher.web.ts) so the two expose identical
// controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const viewSwitcherMeta: StoryMeta = {
    title: 'View Switching/View Switcher',
    description: 'Adw.ViewSwitcher — a segmented switcher whose buttons select pages in a paired Adw.ViewStack.',
    controls: [
        {
            name: 'policy',
            label: 'Policy',
            type: ControlType.SELECT,
            options: [
                { label: 'Wide', value: 'wide' },
                { label: 'Narrow', value: 'narrow' },
            ],
            defaultValue: 'wide',
        },
    ],
};
