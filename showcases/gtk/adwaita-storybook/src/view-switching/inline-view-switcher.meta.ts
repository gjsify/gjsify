// Shared, renderer-agnostic metadata for the Inline View Switcher story.
// Imported by both the GTK renderer (inline-view-switcher.story.ts) and the
// browser renderer (browser/view-switching/inline-view-switcher.web.ts) so the
// two expose identical controls.

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const inlineViewSwitcherMeta: StoryMeta = {
    title: 'View Switching/Inline View Switcher',
    description:
        'Adw.InlineViewSwitcher — a compact inline switcher that can show labels, icons, or both for an Adw.ViewStack.',
    controls: [
        {
            name: 'displayMode',
            label: 'Display mode',
            type: ControlType.SELECT,
            options: [
                { label: 'Labels', value: 'labels' },
                { label: 'Icons', value: 'icons' },
                { label: 'Both', value: 'both' },
            ],
            defaultValue: 'both',
        },
    ],
};
