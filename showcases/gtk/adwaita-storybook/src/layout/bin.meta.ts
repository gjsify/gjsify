// Shared, renderer-agnostic metadata for the Bin story. Imported by the GTK renderer
// (bin.story.ts) and the browser renderer (browser/layout/bin.web.ts).

import { ControlType, type StoryMeta } from '@gjsify/stories';

export const binMeta: StoryMeta = {
    title: 'Layout/Bin',
    description:
        'Adw.Bin — a widget with exactly one child. It draws nothing of its own and gives the child its whole ' +
        'allocation; setting a new child replaces the old one.',
    controls: [
        { name: 'label', label: 'Child label', type: ControlType.TEXT, defaultValue: 'The one child of this bin.' },
        { name: 'swap', label: 'Replace the child', type: ControlType.BOOLEAN, defaultValue: false },
    ],
};
